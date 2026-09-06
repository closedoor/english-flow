export type PatternCategory = "daily" | "request" | "social" | "travel" | "food" | "shopping" | "work";

export type PatternDrill = {
  prompt: string;
  answer: string;
  slot: string;
};

export type PatternItem = {
  id: string;
  category: PatternCategory;
  title: string;
  template: string;
  meaning: string;
  drills: [PatternDrill, PatternDrill, PatternDrill];
};

export const patternCategories: { id: "all" | PatternCategory; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "daily", label: "日常" },
  { id: "request", label: "请求" },
  { id: "social", label: "社交" },
  { id: "travel", label: "出行" },
  { id: "food", label: "餐饮" },
  { id: "shopping", label: "购物" },
  { id: "work", label: "工作" },
];

export const corePatterns: PatternItem[] = [
  { id: "p01", category: "daily", title: "表达想做", template: "I want to ___", meaning: "我想……", drills: [
    { prompt: "我想休息一下。", answer: "I want to take a break.", slot: "take a break" },
    { prompt: "我想学英语。", answer: "I want to learn English.", slot: "learn English" },
    { prompt: "我想早点回家。", answer: "I want to go home early.", slot: "go home early" },
  ] },
  { id: "p02", category: "daily", title: "礼貌表达想要", template: "I'd like to ___", meaning: "我想……（更礼貌）", drills: [
    { prompt: "我想办理入住。", answer: "I'd like to check in.", slot: "check in" },
    { prompt: "我想预订一张桌子。", answer: "I'd like to book a table.", slot: "book a table" },
    { prompt: "我想换座位。", answer: "I'd like to change my seat.", slot: "change my seat" },
  ] },
  { id: "p03", category: "daily", title: "表达正在做", template: "I'm ___", meaning: "我正在……", drills: [
    { prompt: "我正在等朋友。", answer: "I'm waiting for a friend.", slot: "waiting for a friend" },
    { prompt: "我正在找入口。", answer: "I'm looking for the entrance.", slot: "looking for the entrance" },
    { prompt: "我正在学怎么使用它。", answer: "I'm learning how to use it.", slot: "learning how to use it" },
  ] },
  { id: "p04", category: "daily", title: "表达习惯", template: "I usually ___", meaning: "我通常……", drills: [
    { prompt: "我通常七点起床。", answer: "I usually get up at seven.", slot: "get up at seven" },
    { prompt: "我通常坐地铁上班。", answer: "I usually take the subway to work.", slot: "take the subway to work" },
    { prompt: "我通常在家吃早餐。", answer: "I usually have breakfast at home.", slot: "have breakfast at home" },
  ] },
  { id: "p05", category: "daily", title: "表达过去习惯或状态", template: "I used to ___", meaning: "我过去常常……／我以前……（现在已不同）", drills: [
    { prompt: "我以前住在杭州。", answer: "I used to live in Hangzhou.", slot: "live in Hangzhou" },
    { prompt: "我过去常常熬夜。", answer: "I used to stay up late.", slot: "stay up late" },
    { prompt: "我以前每天都开车。", answer: "I used to drive every day.", slot: "drive every day" },
  ] },
  { id: "p06", category: "request", title: "礼貌请求", template: "Could you ___?", meaning: "你可以……吗？", drills: [
    { prompt: "你可以再说一遍吗？", answer: "Could you say that again?", slot: "say that again" },
    { prompt: "你可以帮我一下吗？", answer: "Could you help me?", slot: "help me" },
    { prompt: "你可以说慢一点吗？", answer: "Could you speak more slowly?", slot: "speak more slowly" },
  ] },
  { id: "p07", category: "request", title: "请求获得物品", template: "Can I have ___?", meaning: "可以给我……吗？", drills: [
    { prompt: "可以给我一杯水吗？", answer: "Can I have a glass of water?", slot: "a glass of water" },
    { prompt: "可以给我菜单吗？", answer: "Can I have the menu?", slot: "the menu" },
    { prompt: "可以给我一张收据吗？", answer: "Can I have a receipt?", slot: "a receipt" },
  ] },
  { id: "p08", category: "request", title: "询问能否做", template: "Is it okay if I ___?", meaning: "我……可以吗？", drills: [
    { prompt: "我坐这里可以吗？", answer: "Is it okay if I sit here?", slot: "sit here" },
    { prompt: "我打开窗户可以吗？", answer: "Is it okay if I open the window?", slot: "open the window" },
    { prompt: "我晚点回复可以吗？", answer: "Is it okay if I reply later?", slot: "reply later" },
  ] },
  { id: "p09", category: "request", title: "询问解决方法", template: "Is there any way to ___?", meaning: "有没有办法……？", drills: [
    { prompt: "有没有办法改期？", answer: "Is there any way to change the date?", slot: "change the date" },
    { prompt: "有没有办法退款？", answer: "Is there any way to get a refund?", slot: "get a refund" },
    { prompt: "有没有办法早点入住？", answer: "Is there any way to check in early?", slot: "check in early" },
  ] },
  { id: "p10", category: "request", title: "寻求帮助", template: "Could you help me with ___?", meaning: "你可以帮我处理……吗？", drills: [
    { prompt: "你可以帮我拿行李吗？", answer: "Could you help me with my luggage?", slot: "my luggage" },
    { prompt: "你可以帮我填这张表吗？", answer: "Could you help me with this form?", slot: "this form" },
    { prompt: "你可以帮我处理这个问题吗？", answer: "Could you help me with this problem?", slot: "this problem" },
  ] },
  { id: "p11", category: "social", title: "询问看法", template: "What do you think about ___?", meaning: "你觉得……怎么样？", drills: [
    { prompt: "你觉得这部电影怎么样？", answer: "What do you think about this movie?", slot: "this movie" },
    { prompt: "你觉得这个计划怎么样？", answer: "What do you think about this plan?", slot: "this plan" },
    { prompt: "你觉得这里的食物怎么样？", answer: "What do you think about the food here?", slot: "the food here" },
  ] },
  { id: "p12", category: "social", title: "询问经历", template: "Have you ever ___?", meaning: "你曾经……吗？", drills: [
    { prompt: "你去过日本吗？", answer: "Have you ever been to Japan?", slot: "been to Japan" },
    { prompt: "你试过这个吗？", answer: "Have you ever tried this?", slot: "tried this" },
    { prompt: "你见过他吗？", answer: "Have you ever met him?", slot: "met him" },
  ] },
  { id: "p13", category: "social", title: "表达兴趣", template: "I'm interested in ___", meaning: "我对……感兴趣", drills: [
    { prompt: "我对摄影感兴趣。", answer: "I'm interested in photography.", slot: "photography" },
    { prompt: "我对当地文化感兴趣。", answer: "I'm interested in the local culture.", slot: "the local culture" },
    { prompt: "我对学习英语感兴趣。", answer: "I'm interested in learning English.", slot: "learning English" },
  ] },
  { id: "p14", category: "social", title: "表达不确定", template: "I'm not sure if ___", meaning: "我不确定是否……", drills: [
    { prompt: "我不确定它是否营业。", answer: "I'm not sure if it's open.", slot: "it's open" },
    { prompt: "我不确定他是否会来。", answer: "I'm not sure if he'll come.", slot: "he'll come" },
    { prompt: "我不确定这是否正确。", answer: "I'm not sure if this is correct.", slot: "this is correct" },
  ] },
  { id: "p15", category: "social", title: "解释原因", template: "The reason is that ___", meaning: "原因是……", drills: [
    { prompt: "原因是我迟到了。", answer: "The reason is that I was late.", slot: "I was late" },
    { prompt: "原因是交通很拥堵。", answer: "The reason is that traffic was heavy.", slot: "traffic was heavy" },
    { prompt: "原因是我需要更多时间。", answer: "The reason is that I need more time.", slot: "I need more time" },
  ] },
  { id: "p16", category: "travel", title: "寻找地点", template: "Where can I find ___?", meaning: "我在哪里可以找到……？", drills: [
    { prompt: "我在哪里可以找到洗手间？", answer: "Where can I find the restroom?", slot: "the restroom" },
    { prompt: "我在哪里可以找到出租车？", answer: "Where can I find a taxi?", slot: "a taxi" },
    { prompt: "我在哪里可以找到行李提取处？", answer: "Where can I find baggage claim?", slot: "baggage claim" },
  ] },
  { id: "p17", category: "travel", title: "询问到达方式", template: "How do I get to ___?", meaning: "我怎么去……？", drills: [
    { prompt: "我怎么去火车站？", answer: "How do I get to the train station?", slot: "the train station" },
    { prompt: "我怎么去市中心？", answer: "How do I get to the city center?", slot: "the city center" },
    { prompt: "我怎么去这个地址？", answer: "How do I get to this address?", slot: "this address" },
  ] },
  { id: "p18", category: "travel", title: "询问所需时间", template: "How long does it take to ___?", meaning: "……需要多长时间？", drills: [
    { prompt: "到机场需要多长时间？", answer: "How long does it take to get to the airport?", slot: "get to the airport" },
    { prompt: "走到那里需要多长时间？", answer: "How long does it take to walk there?", slot: "walk there" },
    { prompt: "办理入住需要多长时间？", answer: "How long does it take to check in?", slot: "check in" },
  ] },
  { id: "p19", category: "travel", title: "确认方向", template: "Is this the way to ___?", meaning: "这是去……的路吗？", drills: [
    { prompt: "这是去博物馆的路吗？", answer: "Is this the way to the museum?", slot: "the museum" },
    { prompt: "这是去二号航站楼的路吗？", answer: "Is this the way to Terminal 2?", slot: "Terminal 2" },
    { prompt: "这是去地铁站的路吗？", answer: "Is this the way to the subway station?", slot: "the subway station" },
  ] },
  { id: "p20", category: "travel", title: "说明预订", template: "I have a reservation for ___", meaning: "我预订了……", drills: [
    { prompt: "我预订了两晚。", answer: "I have a reservation for two nights.", slot: "two nights" },
    { prompt: "我预订了两个人的位置。", answer: "I have a reservation for two people.", slot: "two people" },
    { prompt: "我预订了今晚的房间。", answer: "I have a reservation for tonight.", slot: "tonight" },
  ] },
  { id: "p21", category: "food", title: "点餐", template: "I'll have ___", meaning: "我要……", drills: [
    { prompt: "我要鸡肉。", answer: "I'll have the chicken.", slot: "the chicken" },
    { prompt: "我要一杯咖啡。", answer: "I'll have a cup of coffee.", slot: "a cup of coffee" },
    { prompt: "我要每日例汤。", answer: "I'll have the soup of the day.", slot: "the soup of the day" },
  ] },
  { id: "p22", category: "food", title: "询问推荐", template: "What do you recommend for ___?", meaning: "你推荐什么……？", drills: [
    { prompt: "你推荐什么早餐？", answer: "What do you recommend for breakfast?", slot: "breakfast" },
    { prompt: "你推荐什么甜点？", answer: "What do you recommend for dessert?", slot: "dessert" },
    { prompt: "你推荐什么饮料？", answer: "What do you recommend for a drink?", slot: "a drink" },
  ] },
  { id: "p23", category: "food", title: "提出饮食要求", template: "Could I get this without ___?", meaning: "这个可以不加……吗？", drills: [
    { prompt: "这个可以不加洋葱吗？", answer: "Could I get this without onions?", slot: "onions" },
    { prompt: "这个可以不加糖吗？", answer: "Could I get this without sugar?", slot: "sugar" },
    { prompt: "这个可以不加冰吗？", answer: "Could I get this without ice?", slot: "ice" },
  ] },
  { id: "p24", category: "shopping", title: "询问价格", template: "How much is ___?", meaning: "……多少钱？", drills: [
    { prompt: "这个多少钱？", answer: "How much is this?", slot: "this" },
    { prompt: "这件衬衫多少钱？", answer: "How much is this shirt?", slot: "this shirt" },
    { prompt: "配送费多少钱？", answer: "How much is the delivery fee?", slot: "the delivery fee" },
  ] },
  { id: "p25", category: "shopping", title: "寻找商品", template: "I'm looking for ___", meaning: "我在找……", drills: [
    { prompt: "我在找一件夹克。", answer: "I'm looking for a jacket.", slot: "a jacket" },
    { prompt: "我在找充电器。", answer: "I'm looking for a charger.", slot: "a charger" },
    { prompt: "我在找当地特产。", answer: "I'm looking for local specialties.", slot: "local specialties" },
  ] },
  { id: "p26", category: "shopping", title: "询问其他选择", template: "Do you have this in ___?", meaning: "这个有……的吗？", drills: [
    { prompt: "这个有大一点的尺码吗？", answer: "Do you have this in a larger size?", slot: "a larger size" },
    { prompt: "这个有黑色的吗？", answer: "Do you have this in black?", slot: "black" },
    { prompt: "这个有其他款式的吗？", answer: "Do you have this in another style?", slot: "another style" },
  ] },
  { id: "p27", category: "work", title: "说明需要", template: "I need to ___", meaning: "我需要……", drills: [
    { prompt: "我需要确认时间。", answer: "I need to confirm the time.", slot: "confirm the time" },
    { prompt: "我需要完成这份报告。", answer: "I need to finish this report.", slot: "finish this report" },
    { prompt: "我需要和我的经理谈谈。", answer: "I need to talk to my manager.", slot: "talk to my manager" },
  ] },
  { id: "p28", category: "work", title: "说明计划", template: "I'm going to ___", meaning: "我打算……", drills: [
    { prompt: "我打算更新文件。", answer: "I'm going to update the file.", slot: "update the file" },
    { prompt: "我打算明天打电话给他。", answer: "I'm going to call him tomorrow.", slot: "call him tomorrow" },
    { prompt: "我打算检查结果。", answer: "I'm going to check the results.", slot: "check the results" },
  ] },
  { id: "p29", category: "work", title: "确认理解", template: "Do you mean ___?", meaning: "你的意思是……吗？", drills: [
    { prompt: "你的意思是今天吗？", answer: "Do you mean today?", slot: "today" },
    { prompt: "你的意思是我们应该等待吗？", answer: "Do you mean we should wait?", slot: "we should wait" },
    { prompt: "你的意思是价格变了吗？", answer: "Do you mean the price has changed?", slot: "the price has changed" },
  ] },
  { id: "p30", category: "work", title: "提出建议", template: "Why don't we ___?", meaning: "我们为什么不……呢？", drills: [
    { prompt: "我们为什么不明天再试呢？", answer: "Why don't we try again tomorrow?", slot: "try again tomorrow" },
    { prompt: "我们为什么不先检查一下呢？", answer: "Why don't we check first?", slot: "check first" },
    { prompt: "我们为什么不休息一下呢？", answer: "Why don't we take a break?", slot: "take a break" },
  ] },
];
