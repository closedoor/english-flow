#!/usr/bin/env python3
"""Generate three offline-friendly Tatoeba English–Chinese sentence packs.

The weekly source archives are intentionally not committed. Download the
English/Chinese detailed sentence exports and the links export from Tatoeba,
then pass their paths to this script. English text is kept verbatim except for
whitespace normalization; Chinese translations are converted to simplified
Chinese for the learner-facing interface.
"""

from __future__ import annotations

import argparse
import bz2
import json
import re
import tarfile
from collections import defaultdict
from pathlib import Path

try:
    from opencc import OpenCC
except ModuleNotFoundError as error:
    raise SystemExit("Install opencc-python-reimplemented before regenerating the sentence packs.") from error


WORD_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
CJK_RE = re.compile(r"[\u3400-\u9fff]")
BAD_TEXT_RE = re.compile(r"https?://|www\.|@\w+|[_{}<>]|\\[nrt]")
BLOCKED = re.compile(r"\b(?:kill|murder|suicide|rape|porn|prostitut\w*|nazi|terrorist|bomb|bullet\w*|gun|cocaine|heroin|die|death|hate|fight|war|drunk|smash\w*)\b", re.I)
MALFORMED_ENGLISH = re.compile(r"\bdo(?:es)?\s+(?:i|you|we|they|he|she|it)\s+(?:got|went|did|made|took|came|saw|said|gave|knew|thought|found|left|felt|kept|heard|bought|brought|wrote|spoke|ran)\b", re.I)
T2S = OpenCC("t2s")

CATEGORY_TERMS = {
    "daily": "hello hi morning evening today tomorrow home room family friend weather time phone message talk speak tell ask help need want like know think feel remember sorry thanks please".split(),
    "social": "meet invite together party weekend happy busy free love enjoy plan call visit birthday welcome conversation name live".split(),
    "food": "food eat drink water coffee tea breakfast lunch dinner restaurant menu order table bread rice meat fish chicken fruit hungry".split(),
    "travel": "airport flight train bus taxi ticket hotel room passport luggage travel trip station arrive road street map city".split(),
    "shopping": "shop store buy pay price cost money cash card size clothes shirt shoes bag receipt cheap expensive sale".split(),
    "work": "work office school study learn english teacher student class book read write email meeting job computer question answer lecture company project team employee function comments salary tuition".split(),
    "help": "doctor hospital sick pain medicine problem lost police safe careful help emergency wrong broken".split(),
}


def normalize_space(value: str) -> str:
    return " ".join(value.strip().split())


def normalize_chinese(value: str) -> str:
    normalized = T2S.convert(value)
    replacements = {
        "甚么": "什么",
        "计程车": "出租车",
        "公车": "公交车",
        "网路": "网络",
        "企划": "项目",
        "推介": "推荐",
        "连络": "联系",
        "联络": "联系",
        "帐单": "账单",
        "巴士": "公交车",
        "单车": "自行车",
        "月台": "站台",
        "马铃薯": "土豆",
        "妳": "你",
        "咱们": "我们",
        "俺": "我",
    }
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)
    normalized = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", normalized)
    return re.sub(r"\s*([，。！？；：])\s*", r"\1", normalized.replace(",", "，").replace("?", "？").replace("!", "！"))


def read_details(path: Path, language: str) -> dict[int, tuple[str, str]]:
    result: dict[int, tuple[str, str]] = {}
    with bz2.open(path, "rt", encoding="utf-8") as source:
        for line in source:
            fields = line.rstrip("\n").split("\t")
            if len(fields) < 4 or fields[1] != language:
                continue
            result[int(fields[0])] = (normalize_space(fields[2]), fields[3] or "Tatoeba contributor")
    return result


def suitable_english(text: str) -> bool:
    words = WORD_RE.findall(text)
    if not 2 <= len(words) <= 18 or len(text) > 125:
        return False
    if BAD_TEXT_RE.search(text) or BLOCKED.search(text) or MALFORMED_ENGLISH.search(text):
        return False
    if re.search(r"\b(?:drink|drank|drinking)\b.*\bdriv\w*\b|\bdriv\w*\b.*\b(?:drink|drank|drinking)\b", text, re.I):
        return False
    if sum(character.isdigit() for character in text) > 1:
        return False
    if not text[0].isupper() or text[-1] not in ".?!":
        return False
    return sum(character.isalpha() and not character.isascii() for character in text) == 0


def suitable_chinese(text: str) -> bool:
    if not 2 <= len(text) <= 55 or not CJK_RE.search(text) or BAD_TEXT_RE.search(text):
        return False
    return True


def band_for(text: str) -> str:
    count = len(WORD_RE.findall(text))
    return "short" if count <= 7 else "medium" if count <= 12 else "long"


def category_for(text: str) -> str:
    lowered = set(word.lower() for word in WORD_RE.findall(text))
    if "in order" in text.lower():
        lowered.discard("order")
    if re.search(r"\bBill\b", text):
        lowered.discard("bill")
    if re.search(r"\bholds? water\b", text, re.I):
        lowered.discard("water")
    food_context = {"food", "eat", "drink", "restaurant", "menu", "breakfast", "lunch", "dinner", "meal", "plate"}
    if "table" in lowered and not lowered.intersection(food_context):
        lowered.discard("table")
    scores = {category: sum(term in lowered for term in terms) for category, terms in CATEGORY_TERMS.items()}
    winner, score = max(scores.items(), key=lambda item: (item[1], -list(CATEGORY_TERMS).index(item[0])))
    return winner if score else "daily"


def score_sentence(text: str, ranks: dict[str, int]) -> float:
    words = [word.lower() for word in WORD_RE.findall(text)]
    known = [ranks[word] for word in words if word in ranks]
    coverage = len(known) / len(words)
    top_1000 = sum(rank <= 1000 for rank in known) / len(words)
    conversational = sum(word in {"i", "you", "we", "my", "your", "can", "could", "would", "please", "thanks", "where", "when", "what", "how"} for word in words)
    length_target = {"short": 5, "medium": 10, "long": 15}[band_for(text)]
    return coverage * 120 + top_1000 * 55 + conversational * 4 - abs(len(words) - length_target) * 1.5


def load_ngsl_ranks(path: Path) -> dict[str, int]:
    source = path.read_text(encoding="utf-8")
    return {word.lower(): int(rank) for rank, word in re.findall(r'"rank":(\d+),"word":"([^"]+)"', source)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--english", type=Path, required=True)
    parser.add_argument("--chinese", type=Path, required=True)
    parser.add_argument("--links", type=Path, required=True)
    parser.add_argument("--ngsl", type=Path, default=Path("app/ngsl-data.ts"))
    parser.add_argument("--output", type=Path, default=Path("public/data"))
    args = parser.parse_args()

    english = read_details(args.english, "eng")
    chinese = read_details(args.chinese, "cmn")
    candidate_ids = {sentence_id for sentence_id, (text, author) in english.items() if author != "\\N" and suitable_english(text)}
    linked: dict[int, list[int]] = defaultdict(list)
    with tarfile.open(args.links, "r:bz2") as archive:
        member = archive.getmember("links.csv")
        stream = archive.extractfile(member)
        assert stream is not None
        for raw_line in stream:
            left_raw, right_raw = raw_line.split(b"\t", 1)
            left, right = int(left_raw), int(right_raw)
            if left in candidate_ids and right in chinese:
                linked[left].append(right)

    ranks = load_ngsl_ranks(args.ngsl)
    candidates = []
    for sentence_id, translation_ids in linked.items():
        text, author = english[sentence_id]
        translations = [(translation_id, chinese[translation_id][0], chinese[translation_id][1]) for translation_id in translation_ids if suitable_chinese(chinese[translation_id][0])]
        if not translations:
            continue
        translation_id, translation, translation_author = min(translations, key=lambda item: (abs(len(item[1]) - len(text) * .55), item[0]))
        candidates.append({
            "sourceId": sentence_id,
            "translationId": translation_id,
            "text": text,
            "translation": normalize_chinese(translation),
            "author": author,
            "translationAuthor": translation_author,
            "length": band_for(text),
            "category": category_for(text),
            "score": score_sentence(text, ranks),
        })

    chosen = []
    used_text: set[str] = set()
    used_translation: set[str] = set()
    targets = {"short": 1000, "medium": 1000, "long": 1000}
    for band, target in targets.items():
        ranked = sorted((item for item in candidates if item["length"] == band), key=lambda item: (-item["score"], item["sourceId"]))
        category_counts: dict[str, int] = defaultdict(int)
        for item in ranked:
            text_key = item["text"].casefold()
            translation_key = item["translation"]
            if text_key in used_text or translation_key in used_translation:
                continue
            # Avoid letting unclassified "daily" sentences crowd out useful scenes.
            if item["category"] == "daily" and category_counts["daily"] >= int(target * .55):
                continue
            used_text.add(text_key)
            used_translation.add(translation_key)
            category_counts[item["category"]] += 1
            chosen.append(item)
            if sum(1 for selected in chosen if selected["length"] == band) == target:
                break
        selected_count = sum(1 for selected in chosen if selected["length"] == band)
        if selected_count < target:
            raise SystemExit(f"Not enough suitable {band} pairs: selected {selected_count} from {len(ranked)}")

    chosen.sort(key=lambda item: ({"short": 0, "medium": 1, "long": 2}[item["length"]], -item["score"], item["sourceId"]))
    for index, item in enumerate(chosen, 1):
        item["id"] = index
        item.pop("score")

    args.output.mkdir(parents=True, exist_ok=True)
    for pack_index in range(3):
        pack = chosen[pack_index * 1000:(pack_index + 1) * 1000]
        path = args.output / f"tatoeba-sentences-{pack_index + 1}.json"
        path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    meta = {
        "count": len(chosen),
        "bands": targets,
        "packs": 3,
        "source": "Tatoeba weekly exports",
        "license": "CC BY 2.0 FR",
    }
    (args.output / "tatoeba-sentences-meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    main()
