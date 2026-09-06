export type SceneId = "daily" | "restaurant" | "airport" | "hotel" | "shopping";

export type WordItem = {
  id: number;
  rank?: number;
  word: string;
  phonetic: string;
  meaning: string;
  collocations: string[];
  example: string;
  translation: string;
  exampleForm?: string;
  scene: SceneId;
};

export const scenes: { id: SceneId; name: string; subtitle: string; icon: string; color: string }[] = [
  { id: "daily", name: "日常聊天", subtitle: "问候、表达与沟通", icon: "💬", color: "#eef0ff" },
  { id: "restaurant", name: "餐厅", subtitle: "点餐、口味与结账", icon: "🍽️", color: "#fff0e8" },
  { id: "airport", name: "机场", subtitle: "值机、登机与行李", icon: "✈️", color: "#e7f7f4" },
  { id: "hotel", name: "酒店", subtitle: "入住、房间与服务", icon: "🛎️", color: "#fff7d9" },
  { id: "shopping", name: "购物", subtitle: "价格、尺码与付款", icon: "🛍️", color: "#f5eafb" },
];

export const curatedWords: WordItem[] = [
  { id: 1, word: "hello", phonetic: "/həˈloʊ/", meaning: "你好", collocations: ["say hello", "hello there"], example: "Hello, it is nice to meet you.", translation: "你好，很高兴认识你。", scene: "daily" },
  { id: 2, word: "please", phonetic: "/pliːz/", meaning: "请；请问", collocations: ["please sit down", "yes, please"], example: "Please speak a little more slowly.", translation: "请说得稍微慢一点。", scene: "daily" },
  { id: 3, word: "thank you", phonetic: "/ˈθæŋk juː/", meaning: "谢谢你", collocations: ["thank you for…", "thank you very much"], example: "Thank you for your help.", translation: "谢谢你的帮助。", scene: "daily" },
  { id: 4, word: "need", phonetic: "/niːd/", meaning: "需要", collocations: ["need help", "need to go"], example: "I need a little more time.", translation: "我还需要一点时间。", scene: "daily" },
  { id: 5, word: "understand", phonetic: "/ˌʌndərˈstænd/", meaning: "理解；明白", collocations: ["fully understand", "easy to understand"], example: "Sorry, I do not understand.", translation: "抱歉，我没有听懂。", scene: "daily" },
  { id: 6, word: "repeat", phonetic: "/rɪˈpiːt/", meaning: "重复；再说一次", collocations: ["please repeat", "repeat a question"], example: "Could you repeat that, please?", translation: "请问你能再说一次吗？", scene: "daily" },

  { id: 7, word: "menu", phonetic: "/ˈmenjuː/", meaning: "菜单", collocations: ["look at the menu", "drinks menu"], example: "May I see the menu, please?", translation: "请给我看一下菜单好吗？", scene: "restaurant" },
  { id: 8, word: "order", phonetic: "/ˈɔːrdər/", meaning: "点餐；订单", collocations: ["ready to order", "place an order"], example: "We are ready to order now.", translation: "我们现在可以点餐了。", scene: "restaurant" },
  { id: 9, word: "water", phonetic: "/ˈwɔːtər/", meaning: "水", collocations: ["a glass of water", "cold water"], example: "Could I have a glass of water?", translation: "可以给我一杯水吗？", scene: "restaurant" },
  { id: 10, word: "delicious", phonetic: "/dɪˈlɪʃəs/", meaning: "美味的", collocations: ["taste delicious", "delicious food"], example: "This chicken is really delicious.", translation: "这份鸡肉真的很好吃。", scene: "restaurant" },
  { id: 11, word: "without", phonetic: "/wɪˈðaʊt/", meaning: "不带；没有", collocations: ["without sugar", "go without"], example: "I would like coffee without sugar.", translation: "我想要不加糖的咖啡。", scene: "restaurant" },
  { id: 12, word: "bill", phonetic: "/bɪl/", meaning: "账单", collocations: ["pay the bill", "ask for the bill"], example: "Could we have the bill, please?", translation: "请给我们结账好吗？", scene: "restaurant" },

  { id: 13, word: "passport", phonetic: "/ˈpæspɔːrt/", meaning: "护照", collocations: ["show your passport", "passport control"], example: "Here is my passport and ticket.", translation: "这是我的护照和机票。", scene: "airport" },
  { id: 14, word: "flight", phonetic: "/flaɪt/", meaning: "航班；飞行", collocations: ["catch a flight", "direct flight"], example: "My flight leaves at nine.", translation: "我的航班九点起飞。", scene: "airport" },
  { id: 15, word: "gate", phonetic: "/ɡeɪt/", meaning: "登机口；大门", collocations: ["boarding gate", "at the gate"], example: "Your flight boards at Gate 12.", translation: "你的航班在12号登机口登机。", scene: "airport" },
  { id: 16, word: "luggage", phonetic: "/ˈlʌɡɪdʒ/", meaning: "行李", collocations: ["hand luggage", "lost luggage"], example: "Where can I collect my luggage?", translation: "我在哪里领取行李？", scene: "airport" },
  { id: 17, word: "boarding", phonetic: "/ˈbɔːrdɪŋ/", meaning: "登机", collocations: ["boarding pass", "start boarding"], example: "Boarding will begin in ten minutes.", translation: "十分钟后开始登机。", scene: "airport" },
  { id: 18, word: "delayed", phonetic: "/dɪˈleɪd/", meaning: "延误的", collocations: ["flight delayed", "slightly delayed"], example: "The flight is delayed by one hour.", translation: "航班延误了一小时。", scene: "airport" },

  { id: 19, word: "reservation", phonetic: "/ˌrezərˈveɪʃən/", meaning: "预订；预约", collocations: ["make a reservation", "confirm a reservation"], example: "I have a reservation under Chen.", translation: "我用陈这个姓预订了房间。", scene: "hotel" },
  { id: 20, word: "check in", phonetic: "/ˈtʃek ɪn/", meaning: "办理入住；登记", collocations: ["check in online", "check-in time"], example: "I would like to check in, please.", translation: "我想办理入住。", scene: "hotel" },
  { id: 21, word: "room", phonetic: "/ruːm/", meaning: "房间", collocations: ["single room", "room service"], example: "Is the room ready now?", translation: "房间现在准备好了吗？", scene: "hotel" },
  { id: 22, word: "towel", phonetic: "/ˈtaʊəl/", meaning: "毛巾", collocations: ["clean towel", "bath towel"], example: "Could I have two more towels?", translation: "可以再给我两条毛巾吗？", exampleForm: "towels", scene: "hotel" },
  { id: 23, word: "quiet", phonetic: "/ˈkwaɪət/", meaning: "安静的", collocations: ["quiet room", "keep quiet"], example: "Do you have a quiet room?", translation: "你们有安静一点的房间吗？", scene: "hotel" },
  { id: 24, word: "breakfast", phonetic: "/ˈbrekfəst/", meaning: "早餐", collocations: ["have breakfast", "breakfast included"], example: "Is breakfast included in the price?", translation: "房价包含早餐吗？", scene: "hotel" },

  { id: 25, word: "price", phonetic: "/praɪs/", meaning: "价格", collocations: ["good price", "price tag"], example: "What is the price of this shirt?", translation: "这件衬衫多少钱？", scene: "shopping" },
  { id: 26, word: "how much", phonetic: "/ˌhaʊ ˈmʌtʃ/", meaning: "多少钱；多少", collocations: ["how much is it", "how much time"], example: "How much is this bag?", translation: "这个包多少钱？", scene: "shopping" },
  { id: 27, word: "expensive", phonetic: "/ɪkˈspensɪv/", meaning: "昂贵的", collocations: ["too expensive", "expensive hotel"], example: "This jacket is too expensive for me.", translation: "这件夹克对我来说太贵了。", scene: "shopping" },
  { id: 28, word: "size", phonetic: "/saɪz/", meaning: "尺码；大小", collocations: ["right size", "what size"], example: "Do you have this in a larger size?", translation: "这个有大一码的吗？", scene: "shopping" },
  { id: 29, word: "try on", phonetic: "/ˈtraɪ ɑːn/", meaning: "试穿", collocations: ["try it on", "try on clothes"], example: "Can I try on this coat?", translation: "我可以试穿这件外套吗？", exampleForm: "try on", scene: "shopping" },
  { id: 30, word: "receipt", phonetic: "/rɪˈsiːt/", meaning: "收据；小票", collocations: ["keep the receipt", "ask for a receipt"], example: "Please keep your receipt.", translation: "请保留好你的收据。", scene: "shopping" },

  { id: 31, word: "want", phonetic: "/wɑːnt/", meaning: "想要", collocations: ["want to learn", "really want"], example: "I want to learn everyday English.", translation: "我想学习日常英语。", scene: "daily" },
  { id: 32, word: "ready", phonetic: "/ˈredi/", meaning: "准备好的", collocations: ["get ready", "ready to start"], example: "I am ready to start.", translation: "我准备好开始了。", scene: "daily" },
  { id: 33, word: "maybe", phonetic: "/ˈmeɪbi/", meaning: "也许；可能", collocations: ["maybe later", "maybe not"], example: "Maybe we can meet tomorrow.", translation: "也许我们明天可以见面。", scene: "daily" },
  { id: 34, word: "see you", phonetic: "/ˈsiː juː/", meaning: "再见；回头见", collocations: ["see you soon", "see you tomorrow"], example: "See you tomorrow morning.", translation: "明天早上见。", scene: "daily" },
  { id: 35, word: "table", phonetic: "/ˈteɪbəl/", meaning: "桌子；餐桌", collocations: ["a table for two", "at the table"], example: "We need a table for two.", translation: "我们需要一张两人桌。", scene: "restaurant" },
  { id: 36, word: "recommend", phonetic: "/ˌrekəˈmend/", meaning: "推荐", collocations: ["highly recommend", "recommend a dish"], example: "What dish do you recommend?", translation: "你推荐哪一道菜？", scene: "restaurant" },
  { id: 37, word: "hungry", phonetic: "/ˈhʌŋɡri/", meaning: "饥饿的", collocations: ["feel hungry", "very hungry"], example: "I am hungry after the long walk.", translation: "走了很久以后，我饿了。", scene: "restaurant" },
  { id: 38, word: "takeaway", phonetic: "/ˈteɪkəweɪ/", meaning: "外带；外卖", collocations: ["order takeaway", "for takeaway"], example: "Can I get this for takeaway?", translation: "这个可以给我打包吗？", scene: "restaurant" },
  { id: 39, word: "ticket", phonetic: "/ˈtɪkɪt/", meaning: "票；机票", collocations: ["book a ticket", "return ticket"], example: "I booked the ticket online.", translation: "我在网上订了机票。", scene: "airport" },
  { id: 40, word: "arrive", phonetic: "/əˈraɪv/", meaning: "到达", collocations: ["arrive early", "arrive at the airport"], example: "We will arrive in London at noon.", translation: "我们将在中午抵达伦敦。", scene: "airport" },
  { id: 41, word: "depart", phonetic: "/dɪˈpɑːrt/", meaning: "出发；离开", collocations: ["depart from", "depart on time"], example: "The train departs from Platform 4.", translation: "火车从4号站台出发。", exampleForm: "departs", scene: "airport" },
  { id: 42, word: "window seat", phonetic: "/ˈwɪndoʊ siːt/", meaning: "靠窗座位", collocations: ["choose a window seat", "prefer a window seat"], example: "Could I have a window seat?", translation: "可以给我一个靠窗座位吗？", scene: "airport" },
  { id: 43, word: "key", phonetic: "/kiː/", meaning: "钥匙；房卡", collocations: ["room key", "key card"], example: "I left my key in the room.", translation: "我把房卡落在房间里了。", scene: "hotel" },
  { id: 44, word: "clean", phonetic: "/kliːn/", meaning: "干净的；清洁", collocations: ["clean room", "clean up"], example: "The room is bright and clean.", translation: "房间明亮又干净。", scene: "hotel" },
  { id: 45, word: "available", phonetic: "/əˈveɪləbəl/", meaning: "可用的；有空的", collocations: ["room available", "available now"], example: "Is a larger room available tonight?", translation: "今晚有更大的房间吗？", scene: "hotel" },
  { id: 46, word: "check out", phonetic: "/ˈtʃek aʊt/", meaning: "退房；结账离开", collocations: ["check-out time", "late check-out"], example: "What time do we need to check out?", translation: "我们几点需要退房？", scene: "hotel" },
  { id: 47, word: "cheap", phonetic: "/tʃiːp/", meaning: "便宜的", collocations: ["quite cheap", "cheap ticket"], example: "It is cheap but well made.", translation: "它很便宜，但做工很好。", scene: "shopping" },
  { id: 48, word: "cash", phonetic: "/kæʃ/", meaning: "现金", collocations: ["pay in cash", "cash only"], example: "Do I need to pay in cash?", translation: "我需要用现金付款吗？", scene: "shopping" },
  { id: 49, word: "credit card", phonetic: "/ˈkredɪt kɑːrd/", meaning: "信用卡", collocations: ["pay by credit card", "card number"], example: "Can I pay by credit card?", translation: "我可以用信用卡付款吗？", scene: "shopping" },
  { id: 50, word: "return", phonetic: "/rɪˈtɜːrn/", meaning: "退还；返回", collocations: ["return an item", "return home"], example: "Can I return this if it does not fit?", translation: "如果不合身，我可以退货吗？", scene: "shopping" },
];

export const sceneTerms: Record<SceneId, string[]> = {
  daily: "hello|please|thank|thank you|need|understand|repeat|want|ready|maybe|speak|say|tell|ask|answer|meet|friend|family|morning|today|tomorrow|help|sorry|excuse|yes|no|why|what|where|when|who|how|good|fine|happy|feel|think|know|remember|forget|call|message|phone|name|live|work|conversation|question|explain|listen|hear|welcome|see you".split("|"),
  restaurant: "menu|order|water|delicious|without|bill|table|recommend|hungry|takeaway|food|meal|breakfast|lunch|dinner|drink|coffee|tea|sugar|salt|bread|rice|meat|chicken|fish|vegetable|fruit|restaurant|cook|kitchen|taste|dish|bottle|cup|glass|serve".split("|"),
  airport: "passport|flight|gate|luggage|boarding|delayed|ticket|arrive|depart|window seat|travel|journey|bag|check|delay|foreign|country|city|map|leave|land|road|direction|entrance|tourist|route|transport|train|bus|station|platform".split("|"),
  hotel: "reservation|check in|room|towel|quiet|breakfast|key|clean|available|check out|hotel|bed|shower|guest|service|stay|book|night|floor|accommodation|staff|single|double|pool".split("|"),
  shopping: "price|how much|expensive|size|try on|receipt|cheap|cash|credit card|return|shop|store|market|buy|sell|pay|money|cost|sale|customer|product|clothes|clothing|shirt|jacket|shoe|bag|color|small|large|fit|choose|discount|brand|item|change".split("|"),
};
