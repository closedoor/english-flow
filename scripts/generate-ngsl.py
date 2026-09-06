#!/usr/bin/env python3
"""Build the compact NGSL word-card data used by the offline PWA.

Inputs are downloaded separately so a production build never depends on the
network. The generated TypeScript file is committed with the app.
"""

from __future__ import annotations

import argparse
import bz2
import csv
import json
import re
from collections import defaultdict, deque
from pathlib import Path

try:
    from opencc import OpenCC
except ModuleNotFoundError as error:
    raise SystemExit("Install opencc-python-reimplemented before regenerating the NGSL data.") from error


TOKEN_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
POS_RE = re.compile(r"^(?:n|v|vt|vi|a|adj|adv|prep|pron|conj|num|aux|art)\.\s*", re.I)
TECH_RE = re.compile(r"\[(?:计|网络|医|化|经|法|商|机|电子|生化|物|农|矿|建|军|航)\]")
UNSAFE_LEARNER_CONTEXT_RE = re.compile(
    r"\b(?:fuck\w*|shit\w*|bitch\w*|porn\w*|rape\w*|prostitut\w*|suicid\w*|"
    r"cocaine|heroin|nazi\w*|kill(?:ed|ing)?\s+(?:myself|yourself)|"
    r"(?:touch|check)\w*[^.!?]{0,50}(?:live\s+)?wire|(?:live\s+)?wire[^.!?]{0,50}touch\w*|"
    r"how\s+to\s+(?:make|build)\s+(?:a\s+)?bomb)\b",
    re.I,
)
UNSAFE_LEARNER_CONTEXT_ZH_RE = re.compile(r"(?:强奸|色情|妓女|自杀|杀死自己|杀死你自己|海洛因|可卡因|摸.*带电.*线)")
T2S = OpenCC("t2s")

IRREGULAR = {
    "be": ["am", "is", "are", "was", "were", "been", "being"],
    "go": ["goes", "went", "gone", "going"],
    "do": ["does", "did", "done", "doing"],
    "have": ["has", "had", "having"],
    "say": ["says", "said", "saying"],
    "make": ["makes", "made", "making"],
    "take": ["takes", "took", "taken", "taking"],
    "come": ["comes", "came", "coming"],
    "see": ["sees", "saw", "seen", "seeing"],
    "get": ["gets", "got", "gotten", "getting"],
    "give": ["gives", "gave", "given", "giving"],
    "know": ["knows", "knew", "known", "knowing"],
    "think": ["thinks", "thought", "thinking"],
    "find": ["finds", "found", "finding"],
    "tell": ["tells", "told", "telling"],
    "leave": ["leaves", "left", "leaving"],
    "feel": ["feels", "felt", "feeling"],
    "bring": ["brings", "brought", "bringing"],
    "begin": ["begins", "began", "begun", "beginning"],
    "keep": ["keeps", "kept", "keeping"],
    "hold": ["holds", "held", "holding"],
    "write": ["writes", "wrote", "written", "writing"],
    "stand": ["stands", "stood", "standing"],
    "hear": ["hears", "heard", "hearing"],
    "meet": ["meets", "met", "meeting"],
    "run": ["runs", "ran", "running"],
    "pay": ["pays", "paid", "paying"],
    "sit": ["sits", "sat", "sitting"],
    "speak": ["speaks", "spoke", "spoken", "speaking"],
    "read": ["reads", "reading"],
    "buy": ["buys", "bought", "buying"],
    "teach": ["teaches", "taught", "teaching"],
    "learn": ["learns", "learned", "learnt", "learning"],
    "sleep": ["sleeps", "slept", "sleeping"],
    "lose": ["loses", "lost", "losing"],
    "win": ["wins", "won", "winning"],
    "child": ["children"],
    "person": ["people"],
    "man": ["men"],
    "woman": ["women"],
    "foot": ["feet"],
    "tooth": ["teeth"],
    "mouse": ["mice"],
}

MEANING_OVERRIDES = {
    "the": "这/那；特指的人或事物（定冠词）", "a": "一个；任一（不定冠词）",
    "be": "是；存在；成为", "to": "到；向；用于不定式", "of": "……的；属于",
    "and": "和；并且", "in": "在……里面；在……期间", "that": "那；那个；引导从句",
    "have": "有；拥有；已经", "i": "我", "it": "它；这件事", "for": "为了；给；持续",
    "not": "不；没有", "on": "在……上；关于；继续", "with": "和……一起；用；带有",
    "he": "他", "as": "作为；像；当……时", "you": "你；你们", "do": "做；进行；助动词",
    "at": "在；向；对", "this": "这；这个", "but": "但是；除了", "his": "他的",
    "by": "由；通过；在旁边", "from": "从；来自", "they": "他们；她们；它们",
    "we": "我们", "say": "说；表达", "her": "她；她的", "she": "她", "or": "或者；否则",
    "will": "将会；愿意；意志", "one": "一；一个；某人", "all": "全部；所有的",
    "would": "会；愿意（委婉或过去将来）", "there": "那里；有（there be）",
    "their": "他们的；她们的；它们的", "what": "什么；多么", "so": "所以；如此；很",
    "up": "向上；起来；完成", "out": "在外；出去；用完", "if": "如果；是否",
    "about": "关于；大约；周围", "who": "谁；……的人", "get": "得到；到达；变得",
    "which": "哪一个；哪个", "go": "去；走；进行", "me": "我（宾格）", "when": "什么时候；当……时",
    "make": "制作；使得；做出", "can": "能；可以；罐头", "like": "喜欢；像；例如",
    "time": "时间；次数；为……计时", "no": "不；没有；不允许", "just": "刚刚；只是；正好",
    "him": "他（宾格）", "know": "知道；认识；了解", "take": "拿；带；花费；乘坐",
    "people": "人们；人民", "into": "进入；变成", "year": "年；年度", "your": "你的；你们的",
    "good": "好的；有益的", "some": "一些；某些", "could": "能；可以（过去式或委婉）",
    "them": "他们；她们；它们（宾格）", "see": "看见；明白；会见", "other": "其他的；另一个",
    "than": "比；而不是", "then": "然后；当时；那么", "now": "现在；如今",
    "look": "看；看起来；外表", "only": "仅仅；唯一的", "come": "来；来到；发生",
    "its": "它的", "over": "在……上方；超过；结束", "think": "想；认为；思考",
    "also": "也；而且", "back": "后面；回来；背部", "after": "在……之后；追随",
    "use": "使用；用途", "two": "二；两个", "how": "怎样；多么", "our": "我们的",
    "work": "工作；起作用；作品", "first": "第一；首先；最初的", "well": "好；健康的；井",
    "way": "方式；道路；方向", "even": "甚至；平坦的；偶数的", "new": "新的；新近的",
    "want": "想要；需要", "because": "因为", "these": "这些", "give": "给；提供；让步",
    "day": "天；白天；日子", "most": "大多数；最；最多", "us": "我们（宾格）",
    "death": "死亡；去世", "dead": "死的；无生命的；没电的", "drug": "药物；毒品",
    "warm": "温暖的；暖和的；热情的", "sex": "性别；性；性行为", "sexual": "性的；与性有关的",
    "damn": "该死；糟糕（轻度粗话）", "hell": "地狱；糟糕处境；用于加强语气",
    "desire": "渴望；愿望", "trigger": "触发；扳机", "release": "释放；发布；发行",
    "shock": "震惊；冲击", "associate": "联系；联想；同事", "broadcast": "广播；播送",
    "intellectual": "知识分子；智力的", "plate": "盘子；板；牌", "bomb": "炸弹；轰炸",
    "gun": "枪；枪炮", "murder": "谋杀", "proof": "证据；证明",
    "might": "可能；也许；力量（名词）", "attack": "攻击；袭击；侵害",
    "fight": "打架；争吵；努力争取", "shot": "射击；投篮；照片；尝试",
    "civil": "公民的；国内的；有礼貌的", "domestic": "国内的；家庭的；驯养的",
    "abuse": "滥用；虐待；辱骂", "gay": "同性恋的；愉快的（较旧用法）",
    "terrorist": "恐怖分子", "civilian": "平民；民用的",
}

EXAMPLE_OVERRIDES = {
    # Curate the opening run so a brand-new learner's first session is simple,
    # positive and representative of everyday English.
    "the": ("The bus arrives at eight.", "这辆公交车八点到。", "The"),
    "be": ("Be ready at eight.", "八点时请准备好。", "Be"),
    "and": ("Tea and coffee are both available.", "茶和咖啡都有。", "and"),
    "of": ("I would like a glass of water.", "我想要一杯水。", "of"),
    "to": ("I want to learn English.", "我想学英语。", "to"),
    "in": ("The keys are in my bag.", "钥匙在我的包里。", "in"),
    "have": ("I have two sisters.", "我有两个姐妹。", "have"),
    "you": ("You look happy today.", "你今天看起来很开心。", "You"),
    "he": ("He works at a hotel.", "他在一家酒店工作。", "He"),
    "for": ("This gift is for you.", "这份礼物是给你的。", "for"),
    "they": ("They live near the station.", "他们住在车站附近。", "They"),
    "not": ("I am not busy today.", "我今天不忙。", "not"),
    "that": ("That bus goes to the airport.", "那辆公交车开往机场。", "That"),
    "we": ("We study English every morning.", "我们每天早上学习英语。", "We"),
    "with": ("I went to the market with my friend.", "我和朋友一起去了市场。", "with"),
    "this": ("This book is easy to read.", "这本书读起来很容易。", "This"),
    "i": ("I need some help.", "我需要一些帮助。", "I"),
    # Corpus coverage is sparse for some abstract NGSL words. These examples
    # replace generic placeholder sentences with short, natural contexts.
    "instance": ("For instance, you can practice for ten minutes a day.", "例如，你可以每天练习十分钟。", "instance"),
    "unclear": ("The last sentence is unclear to me.", "最后一句话我不太明白。", "unclear"),
    "facility": ("The sports facility opens at eight.", "这个体育设施八点开放。", "facility"),
    "administration": ("The school administration approved the plan.", "学校管理部门批准了这个计划。", "administration"),
    "institution": ("The museum is an important cultural institution.", "这座博物馆是一家重要的文化机构。", "institution"),
    "commercial": ("The channel showed a short commercial.", "这个频道播放了一则短广告。", "commercial"),
    "bind": ("Use this ribbon to bind the pages together.", "用这条丝带把这些页面装订在一起。", "bind"),
    "technical": ("Please contact technical support for help.", "如需帮助，请联系技术支持。", "technical"),
    "assessment": ("The teacher completed an assessment of my progress.", "老师完成了对我学习进度的评估。", "assessment"),
    "studio": ("The artist works in a bright studio.", "这位艺术家在明亮的工作室里工作。", "studio"),
    "perspective": ("Travel can change your perspective on life.", "旅行可以改变你看待生活的角度。", "perspective"),
    "commitment": ("Learning a language takes time and commitment.", "学习一门语言需要时间和投入。", "commitment"),
    "provision": ("The contract includes a provision for early cancellation.", "合同中包含提前取消的条款。", "provision"),
    "wed": ("They plan to wed next spring.", "他们计划明年春天结婚。", "wed"),
    "notion": ("I disagree with the notion that learning must be difficult.", "我不同意学习一定很难这种观念。", "notion"),
    "researcher": ("The researcher collected data from fifty students.", "这名研究人员收集了五十名学生的数据。", "researcher"),
    "significantly": ("Her English has improved significantly this year.", "她的英语今年有了显著进步。", "significantly"),
    "county": ("The river runs through the whole county.", "这条河流经整个县。", "county"),
    "voter": ("Each voter received a paper ballot.", "每位选民都领到了一张纸质选票。", "voter"),
    "estate": ("The family owns a small country estate.", "这家人拥有一处小型乡间庄园。", "estate"),
    "equally": ("The two options are equally useful.", "这两个选项同样有用。", "equally"),
    "prior": ("Prior experience is helpful but not required.", "有相关经验会有帮助，但不是必需的。", "Prior"),
    "liberal": ("She has a liberal attitude toward new ideas.", "她对新想法持开明态度。", "liberal"),
    "effectively": ("This simple method works effectively.", "这个简单的方法很有效。", "effectively"),
    "elsewhere": ("This book is sold out here, but you may find it elsewhere.", "这本书这里卖完了，但你也许能在别处找到。", "elsewhere"),
    "mechanism": ("The lock has a simple mechanism.", "这把锁的机械结构很简单。", "mechanism"),
    "enhance": ("Pictures can enhance a language lesson.", "图片可以提升语言课程的效果。", "enhance"),
    "substantial": ("The project made substantial progress this month.", "这个项目本月取得了重大进展。", "substantial"),
    "manufacturer": ("The manufacturer offers a two-year warranty.", "制造商提供两年保修。", "manufacturer"),
    "highlight": ("Use a marker to highlight the key sentence.", "用记号笔标出关键句。", "highlight"),
    "output": ("The factory increased its output this year.", "这家工厂今年提高了产量。", "output"),
    "prospect": ("The prospect of travel made her excited.", "旅行的可能让她很兴奋。", "prospect"),
    "criteria": ("Price and quality are our main criteria.", "价格和质量是我们的主要标准。", "criteria"),
    "primarily": ("This course is designed primarily for beginners.", "这门课程主要为初学者设计。", "primarily"),
    "retain": ("Regular review helps you retain new words.", "定期复习有助于记住新单词。", "retain"),
    "sequence": ("Put the pictures in the correct sequence.", "请按正确顺序排列这些图片。", "sequence"),
    "dramatic": ("The story has a dramatic ending.", "这个故事有一个戏剧性的结局。", "dramatic"),
    "protein": ("Eggs are a good source of protein.", "鸡蛋是优质蛋白质来源。", "protein"),
    "negotiate": ("They met to negotiate a new contract.", "他们见面商谈一份新合同。", "negotiate"),
    "typically": ("The shop typically closes at six.", "这家商店通常六点关门。", "typically"),
    "pension": ("She receives a pension after retirement.", "她退休后领取养老金。", "pension"),
    "acquisition": ("The library announced the acquisition of rare books.", "图书馆宣布购入了一批珍贵书籍。", "acquisition"),
    "respectively": ("Anna and Ben scored eighty and ninety, respectively.", "安娜和本分别得了八十分和九十分。", "respectively"),
    "variation": ("There is some variation in pronunciation.", "发音存在一些差异。", "variation"),
    "representation": ("The chart is a clear representation of the results.", "这张图清楚地呈现了结果。", "representation"),
    "enterprise": ("She started a small online enterprise.", "她创办了一家小型线上企业。", "enterprise"),
    "virtually": ("The two bags are virtually identical.", "这两个包几乎完全一样。", "virtually"),
    "coverage": ("The news channel provided live coverage of the event.", "新闻频道对这场活动进行了直播报道。", "coverage"),
    "recruit": ("The company plans to recruit ten new employees.", "这家公司计划招聘十名新员工。", "recruit"),
    "underlie": ("Trust and respect underlie a strong friendship.", "信任和尊重是牢固友谊的基础。", "underlie"),
    "evaluate": ("We need to evaluate all three choices.", "我们需要评估这三个选择。", "evaluate"),
    "innovation": ("The award recognizes innovation in education.", "这个奖项表彰教育领域的创新。", "innovation"),
    "adviser": ("Talk to your adviser before choosing a course.", "选课前先和你的指导老师谈谈。", "adviser"),
    "curve": ("The road follows a gentle curve.", "这条路沿着一条平缓的弯道延伸。", "curve"),
    "intervention": ("Early intervention can prevent a small problem from growing.", "尽早干预可以防止小问题扩大。", "intervention"),
    "similarly": ("The two machines work similarly.", "这两台机器的工作方式相似。", "similarly"),
    "dimension": ("Please measure each dimension of the box.", "请测量盒子的各项尺寸。", "dimension"),
    "subsequent": ("Subsequent meetings were much shorter.", "后来的会议短了很多。", "Subsequent"),
    "shareholder": ("Each shareholder received the annual report.", "每位股东都收到了年度报告。", "shareholder"),
    "resistance": ("The new material has strong resistance to heat.", "这种新材料具有很强的耐热性。", "resistance"),
    "involvement": ("Her involvement made the community project successful.", "她的参与让这个社区项目取得了成功。", "involvement"),
    "exposure": ("Daily exposure to English improves listening skills.", "每天接触英语可以提高听力。", "exposure"),
    "establishment": ("The establishment of the new school took two years.", "这所新学校的建立花了两年时间。", "establishment"),
    "characterize": ("Warm colors characterize her paintings.", "暖色调是她画作的特点。", "characterize"),
    "consultant": ("The company hired a consultant to improve its service.", "这家公司聘请了一位顾问来改善服务。", "consultant"),
    "historian": ("The historian wrote a book about the city.", "这位历史学家写了一本关于这座城市的书。", "historian"),
    "visual": ("The diagram provides a clear visual guide.", "这张图表提供了清晰的视觉指引。", "visual"),
    "segment": ("This segment of the program lasts ten minutes.", "节目这一部分持续十分钟。", "segment"),
    "preference": ("My preference is to study in the morning.", "我更喜欢在早上学习。", "preference"),
    "comprehensive": ("The guide provides a comprehensive introduction.", "这份指南提供了全面的介绍。", "comprehensive"),
    "incentive": ("The bonus gave the team an incentive to finish early.", "奖金给了团队提前完成工作的动力。", "incentive"),
    "margin": ("Leave a wide margin on the left side of the page.", "请在页面左侧留出较宽的空白。", "margin"),
    "counsel": ("She asked a lawyer for legal counsel.", "她向律师寻求法律意见。", "counsel"),
    "acceptable": ("This answer is clear and acceptable.", "这个答案清楚而且可以接受。", "acceptable"),
    "measurement": ("The measurement must be accurate.", "测量结果必须准确。", "measurement"),
    "mortgage": ("They applied for a mortgage to buy a home.", "他们申请了住房贷款来买房。", "mortgage"),
    "evaluation": ("The final evaluation showed steady progress.", "最终评估显示出了稳定的进步。", "evaluation"),
    "format": ("Please save the document in PDF format.", "请把文件保存为 PDF 格式。", "format"),
    "compensation": ("The company offered compensation for the delay.", "公司为延误提供了补偿。", "compensation"),
    "versus": ("The final match is Brazil versus Spain.", "决赛是巴西队对西班牙队。", "versus"),
    "deficit": ("The city reduced its budget deficit.", "这座城市缩小了预算赤字。", "deficit"),
    "personnel": ("All personnel must wear an identification card.", "所有人员都必须佩戴身份卡。", "personnel"),
    "dramatically": ("Prices fell dramatically after the holiday.", "假期过后价格大幅下降。", "dramatically"),
    "clause": ("Read each clause before signing the contract.", "签合同前请阅读每一项条款。", "clause"),
    "boost": ("A short walk can boost your energy.", "短时间散步可以让你更有精神。", "boost"),
    "maintenance": ("The elevator is closed for maintenance.", "电梯因维修暂停使用。", "maintenance"),
    "consequently": ("The road was icy; consequently, school opened late.", "路面结冰，所以学校延迟开放。", "consequently"),
    "constraint": ("Time is the main constraint on this project.", "时间是这个项目的主要限制。", "constraint"),
    "potentially": ("This change could potentially save time.", "这项改变有可能节省时间。", "potentially"),
    "diversity": ("The festival celebrates cultural diversity.", "这个节日庆祝文化多样性。", "diversity"),
    "allege": ("They allege that the rule is unfair.", "他们声称这项规定不公平。", "allege"),
    "stability": ("Regular exercise can improve balance and stability.", "经常锻炼可以改善平衡和稳定性。", "stability"),
    "presumably": ("The train is delayed, presumably because of the storm.", "火车晚点了，大概是因为暴风雨。", "presumably"),
    "amendment": ("They proposed an amendment to the agreement.", "他们提出了对协议的修订。", "amendment"),
    "scan": ("Please scan the code with your phone.", "请用手机扫描这个二维码。", "scan"),
    "narrative": ("The novel follows a simple narrative.", "这本小说采用了简单的叙事方式。", "narrative"),
    "surprisingly": ("The small room was surprisingly quiet.", "这个小房间出人意料地安静。", "surprisingly"),
    "catalog": ("You can search the library catalog online.", "你可以在线搜索图书馆目录。", "catalog"),
    "guideline": ("Follow each safety guideline carefully.", "请认真遵守每一项安全准则。", "guideline"),
    "biological": ("Sleep is a basic biological need.", "睡眠是一种基本的生理需要。", "biological"),
    "cluster": ("A cluster of houses stands near the lake.", "湖边坐落着一小片房屋。", "cluster"),
    "vessel": ("The vessel arrived safely at the port.", "这艘船安全抵达港口。", "vessel"),
    "adjustment": ("The new schedule requires a small adjustment.", "新日程需要稍作调整。", "adjustment"),
    "flexible": ("My working hours are flexible.", "我的工作时间很灵活。", "flexible"),
    "summarize": ("Please summarize the article in three sentences.", "请用三句话概括这篇文章。", "summarize"),
    "uncertainty": ("The weather forecast created some uncertainty.", "天气预报带来了一些不确定性。", "uncertainty"),
    "pregnancy": ("Regular medical care is important during pregnancy.", "怀孕期间定期接受医疗检查很重要。", "pregnancy"),
    "institutional": ("The university made an institutional change.", "这所大学进行了一项制度改革。", "institutional"),
    "subsequently": ("He apologized and subsequently corrected the mistake.", "他道了歉，随后改正了错误。", "subsequently"),
    "qualification": ("Teaching experience is a useful qualification.", "教学经验是一项有用的资历。", "qualification"),
    "functional": ("The old camera is still functional.", "这台旧相机仍然可以使用。", "functional"),
    "structural": ("Engineers found no structural damage to the bridge.", "工程师没有发现桥梁存在结构性损坏。", "structural"),
    "listener": ("A good listener asks thoughtful questions.", "善于倾听的人会提出经过思考的问题。", "listener"),
    "module": ("This module teaches useful travel phrases.", "这个模块教授实用的旅行短语。", "module"),
    "attachment": ("I added the receipt as an email attachment.", "我把收据作为邮件附件添加了。", "attachment"),
    "holder": ("The ticket holder may enter through this gate.", "持票人可以从这个入口进入。", "holder"),
    "thirst": ("A cold drink satisfied my thirst after the walk.", "散步后，一杯冷饮解了我的渴。", "thirst"),
    # The first cards shape the learner's trust in the product. Keep them
    # concrete, neutral and useful instead of accepting an arbitrary corpus
    # sentence just because it contains the target word.
    "a": ("She bought a new bag.", "她买了一个新包。", "a"),
    "it": ("I bought it yesterday.", "我昨天买了它。", "it"),
    "on": ("The keys are on the table.", "钥匙在桌上。", "on"),
    "would": ("Would you like some tea?", "你想喝点茶吗？", "Would"),
    "give": ("Please give me a minute.", "请给我一分钟。", "give"),
    "might": ("It might rain this afternoon.", "今天下午可能会下雨。", "might"),
    "large": ("They live in a large house.", "他们住在一所大房子里。", "large"),
    "market": ("We bought fresh fruit at the market.", "我们在市场买了新鲜水果。", "market"),
    "against": ("The bicycle rests against the wall.", "自行车靠在墙上。", "against"),
    "control": ("Use this button to control the volume.", "用这个按钮调节音量。", "control"),
    "body": ("Regular exercise is good for your body.", "经常锻炼对身体有好处。", "body"),
    "die": ("Plants die without enough water.", "植物缺少足够的水就会枯死。", "die"),
    "patient": ("The patient is feeling better today.", "这位病人今天感觉好多了。", "patient"),
    "exist": ("Many solutions exist for this problem.", "这个问题有许多解决办法。", "exist"),
    "fight": ("The two brothers sometimes fight over small things.", "这两兄弟有时会为小事争吵。", "fight"),
    "attack": ("The disease can attack healthy plants.", "这种病会侵害健康的植物。", "attack"),
    "argument": ("They had an argument about the plan.", "他们为这个计划争论了一番。", "argument"),
    "anyway": ("It was raining, but we went anyway.", "当时在下雨，但我们还是去了。", "anyway"),
    "blood": ("The nurse took a small blood sample.", "护士采集了少量血样。", "blood"),
    "consumer": ("A careful consumer compares prices before buying.", "谨慎的消费者会在购买前比较价格。", "consumer"),
    "nuclear": ("Nuclear energy can produce electricity.", "核能可以用来发电。", "Nuclear"),
    "neighbor": ("Our new neighbor invited us for tea.", "我们的新邻居邀请我们去喝茶。", "neighbor"),
    "army": ("She joined the army after college.", "她大学毕业后参了军。", "army"),
    "civil": ("They had a calm and civil discussion.", "他们进行了一场冷静而有礼貌的讨论。", "civil"),
    "domestic": ("Domestic flights leave from Terminal One.", "国内航班从一号航站楼出发。", "Domestic"),
    "abuse": ("The rules protect people from abuse.", "这些规定保护人们免受虐待。", "abuse"),
    "shot": ("I took a great shot with my camera.", "我用相机拍了一张很棒的照片。", "shot"),
    "yield": ("This field can yield a good crop.", "这块田可以产出好收成。", "yield"),
    "crash": ("The app may crash if the phone has no free storage.", "如果手机没有可用存储空间，这个应用可能会崩溃。", "crash"),
    "mouse": ("Click the icon with your mouse.", "用鼠标点击这个图标。", "mouse"),
    "gay": ("The club welcomes gay and straight students.", "这个社团欢迎同性恋和异性恋学生。", "gay"),
    "terrorist": ("The article explains how the term terrorist is used.", "这篇文章解释了“恐怖分子”一词的用法。", "terrorist"),
    "random": ("We chose a winner at random.", "我们随机选出了一名获胜者。", "random"),
    "civilian": ("The rescue team helped every civilian leave safely.", "救援队帮助每一位平民安全离开。", "civilian"),
    "stain": ("There is a coffee stain on my shirt.", "我的衬衫上有一块咖啡渍。", "stain"),
    "hunger": ("The charity works to reduce hunger.", "这家慈善机构致力于减少饥饿。", "hunger"),
    "death": ("The book discusses life and death.", "这本书讨论生命与死亡。", "death"),
    "drug": ("This drug should be taken after meals.", "这种药应该在饭后服用。", "drug"),
    "release": ("The new software release is available today.", "新版软件今天发布。", "release"),
    "associate": ("Many people associate summer with holidays.", "许多人会把夏天和假期联系起来。", "associate"),
    "dead": ("The phone will not start because its battery is dead.", "这部手机无法开机，因为电池没电了。", "dead"),
    "sex": ("The form asks for your age and sex.", "这张表格要求填写年龄和性别。", "sex"),
    "desire": ("She has a strong desire to learn English.", "她有强烈的英语学习愿望。", "desire"),
    "shock": ("The news came as a shock to everyone.", "这个消息让所有人感到震惊。", "shock"),
    "bomb": ("Experts safely removed the old bomb.", "专家安全地移除了那枚旧炸弹。", "bomb"),
    "gun": ("The museum displays an old gun behind glass.", "博物馆把一把旧枪陈列在玻璃柜后。", "gun"),
    "sexual": ("The course explains sexual health in clear language.", "这门课程用清晰的语言讲解性健康。", "sexual"),
    "plate": ("She put a plate of fruit on the table.", "她把一盘水果放在桌上。", "plate"),
    "hell": ("The phrase 'what the hell' can sound rude.", "短语“what the hell”听起来可能很不礼貌。", "hell"),
    "intellectual": ("The discussion was an intellectual challenge.", "这场讨论是一项智力挑战。", "intellectual"),
    "broadcast": ("The station will broadcast the weather report at six.", "电台将在六点播送天气预报。", "broadcast"),
    "damn": ("Some people use 'damn' when they are annoyed.", "有些人在烦恼时会说“damn”。", "damn"),
    "trigger": ("A loud noise can trigger the alarm.", "巨大的响声可能触发警报。", "trigger"),
    "murder": ("The novel begins with a murder mystery.", "这部小说以一起谋杀悬案开篇。", "murder"),
    "proof": ("The photo is proof that the work is complete.", "这张照片证明工作已经完成。", "proof"),
}

SCENE_WORDS = {
    "restaurant": set("restaurant food meal eat drink breakfast lunch dinner coffee tea water bread rice meat fish chicken egg milk sugar salt fruit vegetable menu order bill cook kitchen taste hungry serve dish table bottle cup glass".split()),
    "airport": set("airport airplane aircraft airline flight fly passport ticket luggage baggage gate board boarding depart departure arrive arrival travel trip journey train bus station platform seat route tourist tourism foreign abroad destination delay delayed".split()),
    "hotel": set("hotel room bedroom bathroom bed towel key guest reservation reserve accommodation stay reception shower clean quiet available service elevator floor".split()),
    "shopping": set("shop shopping store market buy sell sale price cost cheap expensive money cash card credit pay payment size clothes clothing shirt coat jacket shoe bag receipt return customer product item brand choose".split()),
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ngsl", type=Path, default=Path("/tmp/ngsl_stats.csv"))
    parser.add_argument("--ecdict", type=Path, default=Path("/tmp/ecdict/ecdict.csv"))
    parser.add_argument("--sentences-en", type=Path, default=Path("/tmp/tatoeba-ngsl/eng_sentences.tsv.bz2"))
    parser.add_argument("--sentences-zh", type=Path, default=Path("/tmp/tatoeba-ngsl/cmn_sentences.tsv.bz2"))
    parser.add_argument("--links", type=Path, default=Path("/tmp/tatoeba-ngsl/eng-cmn_links.tsv.bz2"))
    parser.add_argument("--output", type=Path, default=Path("app/ngsl-data.ts"))
    return parser.parse_args()


def forms_for(word: str) -> set[str]:
    forms = set(IRREGULAR.get(word, []))
    if word.endswith("y") and len(word) > 2 and word[-2] not in "aeiou":
        forms.update((word[:-1] + "ies", word[:-1] + "ied"))
    elif word.endswith("e"):
        forms.update((word + "s", word + "d", word[:-1] + "ing"))
    else:
        forms.update((word + "s", word + "ed", word + "ing"))
    if word.endswith(("s", "x", "z", "ch", "sh")):
        forms.add(word + "es")
    forms.update((word + "er", word + "est"))
    return forms


def clean_meaning(word: str, text: str) -> str:
    if word in MEANING_OVERRIDES:
        return MEANING_OVERRIDES[word]
    parts = []
    for line in text.replace("\\r", "\n").replace("\\n", "\n").splitlines():
        line = line.strip()
        if not line or line.startswith("[") or TECH_RE.search(line):
            continue
        line = POS_RE.sub("", line)
        line = line.replace("...", "……").replace(" ,", ",")
        if line and line not in parts:
            parts.append(line)
        if len("；".join(parts)) >= 38 or len(parts) >= 2:
            break
    value = "；".join(parts) or "常用英语词汇"
    return T2S.convert(value[:68].rstrip("，,；; "))


def read_dictionary(path: Path, wanted: set[str]):
    result = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            word = row["word"].lower()
            if word not in wanted:
                continue
            phonetic = row["phonetic"].strip()
            result[word] = {
                "phonetic": f"/{phonetic}/" if phonetic else "",
                "meaning": clean_meaning(word, row["translation"]),
                "pos": row["pos"].split(":", 1)[0].lower(),
            }
    return result


def chinese_score(text: str) -> tuple[int, int]:
    traditional = sum(text.count(ch) for ch in "們這為後時會讓開來說對沒麼還嗎點學體與裡國發現實應該從個")
    return traditional, abs(len(text) - 14)


def build_examples(lemmas: list[str], en_path: Path, zh_path: Path, links_path: Path):
    links: dict[int, list[int]] = defaultdict(list)
    with bz2.open(links_path, "rt", encoding="utf-8") as handle:
        for line in handle:
            left, right = line.rstrip("\n").split("\t")
            links[int(left)].append(int(right))

    wanted_zh = {item for values in links.values() for item in values}
    zh = {}
    with bz2.open(zh_path, "rt", encoding="utf-8") as handle:
        for line in handle:
            sentence_id, _lang, text = line.rstrip("\n").split("\t", 2)
            if int(sentence_id) in wanted_zh:
                zh[int(sentence_id)] = text

    lemma_set = set(lemmas)
    form_map: dict[str, set[str]] = defaultdict(set)
    for lemma in lemmas:
        for form in forms_for(lemma):
            if form not in lemma_set:
                form_map[form].add(lemma)

    best: dict[str, list[tuple[float, str, str, str]]] = {}
    with bz2.open(en_path, "rt", encoding="utf-8") as handle:
        for line in handle:
            sentence_id, _lang, sentence = line.rstrip("\n").split("\t", 2)
            linked = links.get(int(sentence_id))
            if not linked or len(sentence) > 120 or re.search(r"\d|https?://|[@#]", sentence):
                continue
            translations = [T2S.convert(zh[item]) for item in linked if item in zh and 2 <= len(zh[item]) <= 70]
            if not translations:
                continue
            translation = min(translations, key=chinese_score)
            if UNSAFE_LEARNER_CONTEXT_RE.search(sentence) or UNSAFE_LEARNER_CONTEXT_ZH_RE.search(translation):
                continue
            tokens = [item.lower() for item in TOKEN_RE.findall(sentence)]
            if not (3 <= len(tokens) <= 20):
                continue
            candidates: dict[str, str] = {}
            for token in tokens:
                if token in lemma_set:
                    candidates[token] = token
                elif token in form_map and len(form_map[token]) == 1:
                    candidates[next(iter(form_map[token]))] = token
            if not candidates:
                continue
            unknown = sum(token not in lemma_set and token not in form_map for token in tokens)
            caps = sum(1 for token in sentence.split()[1:] if token[:1].isupper())
            odd = 8 if re.search(r"[\[\]{}<>]|\.{3}|!{2,}|\?{2,}", sentence) else 0
            for lemma, matched in candidates.items():
                inflected = 0 if matched == lemma else 4
                score = abs(len(tokens) - 8) * 1.4 + unknown * 1.7 + caps * 1.3 + odd + inflected + chinese_score(translation)[0] * 2
                option = (score, sentence, translation, matched)
                options = best.setdefault(lemma, [])
                if any(existing[1] == sentence for existing in options):
                    continue
                options.append(option)
                options.sort(key=lambda item: item[0])
                del options[12:]
    return best


def fallback_example(word: str, pos: str) -> tuple[str, str, str]:
    if pos.startswith("v"):
        return f"They {word} it in everyday life.", f"他们在日常生活中会用到“{word}”这个动作。", word
    if pos.startswith(("a", "adj")):
        return f"It seems {word} in this situation.", f"在这种情况下，它显得很“{word}”。", word
    if pos.startswith("adv"):
        return f"We can use it {word} in a sentence.", f"我们可以在句子中这样使用“{word}”。", word
    if pos.startswith("n"):
        return f"The {word} is important in this example.", f"在这个例子中，“{word}”很重要。", word
    return f"This example uses the word {word}.", f"这个例句使用了单词“{word}”。", word


def collocations(sentence: str, matched: str, word: str) -> list[str]:
    tokens = TOKEN_RE.findall(sentence)
    lowered = [token.lower() for token in tokens]
    try:
        index = lowered.index(matched.lower())
    except ValueError:
        return [f"use {word}", f"{word} in context"]
    choices = []
    if index > 0:
        choices.append(" ".join(tokens[index - 1:index + 1]).lower())
    if index + 1 < len(tokens):
        choices.append(" ".join(tokens[index:index + 2]).lower())
    if index > 0 and index + 1 < len(tokens):
        choices.append(" ".join(tokens[index - 1:index + 2]).lower())
    if index >= 2:
        choices.append(" ".join(tokens[index - 2:index + 1]).lower())
    if index + 2 < len(tokens):
        choices.append(" ".join(tokens[index:index + 3]).lower())
    unique = []
    for item in choices:
        if item not in unique and item != word:
            unique.append(item)
    return unique[:2] or [word]


def scene_for(word: str, meaning: str) -> str:
    for scene, words in SCENE_WORDS.items():
        if word in words:
            return scene
    if re.search(r"餐|饭|食|饮|菜|肉|鱼|奶|咖啡|茶|厨房|饥|饿|味", meaning):
        return "restaurant"
    if re.search(r"机场|航班|飞机|旅行|旅程|车站|火车|登机|行李|护照|出发|到达", meaning):
        return "airport"
    if re.search(r"酒店|旅馆|房间|卧室|浴室|住宿|预订|客人|毛巾|床", meaning):
        return "hotel"
    if re.search(r"购买|出售|商店|市场|价格|便宜|昂贵|付款|现金|顾客|衣服|尺寸|商品", meaning):
        return "shopping"
    return "daily"


def ts_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def main():
    args = parse_args()
    with args.ngsl.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    lemmas = [row["Lemma"].lower() for row in rows]
    if len(lemmas) != 2809 or len(set(lemmas)) != 2809:
        raise SystemExit(f"Expected 2,809 unique NGSL lemmas, got {len(lemmas)}")

    dictionary = read_dictionary(args.ecdict, set(lemmas))
    examples = build_examples(lemmas, args.sentences_en, args.sentences_zh, args.links)
    output = [
        "// Generated by scripts/generate-ngsl.py. Do not edit by hand.",
        "// NGSL 1.2 (CC BY-SA 4.0), ECDICT (MIT), Tatoeba sentence pairs (CC BY 2.0 FR).",
        'import type { WordItem } from "./data";',
        "",
        "export const ngslWords: WordItem[] = [",
    ]
    fallback_count = 0
    recent_sentences: deque[str] = deque(maxlen=45)
    for rank, (row, word) in enumerate(zip(rows, lemmas), 1):
        info = dictionary[word]
        if word in EXAMPLE_OVERRIDES:
            sentence, translation, matched = EXAMPLE_OVERRIDES[word]
        elif word in examples:
            options = examples[word]
            choice = next((item for item in options if item[1] not in recent_sentences), options[0])
            _score, sentence, translation, matched = choice
        else:
            sentence, translation, matched = fallback_example(word, info["pos"])
            fallback_count += 1
        recent_sentences.append(sentence)
        scene = scene_for(word, info["meaning"])
        chunks = collocations(sentence, matched, word)
        record = {
            "id": rank,
            "rank": rank,
            "word": word,
            "phonetic": info["phonetic"],
            "meaning": info["meaning"],
            "collocations": chunks,
            "example": sentence,
            "translation": translation,
            "exampleForm": matched,
            "scene": scene,
        }
        output.append("  " + json.dumps(record, ensure_ascii=False, separators=(",", ":")) + ",")
    output.extend([
        "];",
        "",
        "export const ngslMeta = { version: \"1.2\", count: 2809, fallbackExamples: " + str(fallback_count) + " } as const;",
        "",
    ])
    args.output.write_text("\n".join(output), encoding="utf-8")
    print(f"Wrote {len(lemmas)} entries to {args.output}; {fallback_count} fallback examples")


if __name__ == "__main__":
    main()
