import type en from "./en";

const zh: typeof en = {
  brand: "BRAND.",
  nav: {
    products: "产品", wholesale: "批发合作", privateLabel: "自有品牌",
    about: "关于我们", contact: "联系", quote: "获取报价", menu: "打开菜单", primary: "主导航", language: "语言",
  },
  hero: {
    eyebrow: "批发合作  /  自有品牌  /  OEM · ODM",
    first: "高品质美妆产品", second: "为你的品牌而生。",
    body: "面向品牌、经销商和美妆专业人士，提供批发、自有品牌与定制美妆合作方案。",
    explore: "探索产品", quote: "获取报价", visualCaption: "关于美妆的更多可能",
  },
  categories: {
    eyebrow: "01  /  产品系列", title: "以审美，定义美妆。",
    body: "聚焦两大品类，为你的下一季产品系列提供灵活起点。",
    explore: "探索系列",
    items: [
      { name: "穿戴甲", body: "沙龙风格穿戴甲系列，适合批发、自有品牌及定制合作。", label: "穿戴甲系列  /  01", path: "products/press-on-nails" },
      { name: "假睫毛", body: "面向美妆品牌、零售商和经销商的专业假睫毛系列。", label: "假睫毛系列  /  02", path: "products/false-eyelashes" },
    ],
  },
  value: {
    eyebrow: "02  /  合作价值", title: "为什么选择与我们合作",
    body: "关注塑造美妆产品系列的每一个关键细节。",
    items: [
      { title: "低起订量", body: "根据项目需求沟通合适的订单规模。" },
      { title: "自有品牌", body: "让产品系列呈现鲜明的品牌个性。" },
      { title: "定制包装", body: "围绕品牌打造开箱体验。" },
      { title: "质量把控", body: "在生产流程中规划产品检验。" },
      { title: "全球运输", body: "根据目标市场协调交付。" },
      { title: "OEM / ODM 支持", body: "探索产品开发与定制的可能性。" },
    ],
  },
  privateLabel: {
    eyebrow: "03  /  自有品牌", title: "打造你的美妆品牌",
    body: "从产品方向到细节呈现，打造具有清晰品牌表达的系列。",
    items: ["产品定制", "标识与品牌设计", "包装", "自有品牌", "OEM / ODM"],
    action: "启动你的项目", visualLabel: "为你的创想而打造",
  },
  process: {
    eyebrow: "04  /  合作流程", title: "合作如何进行",
    steps: [
      { title: "选择产品", body: "确定品类与系列方向。" },
      { title: "沟通定制", body: "明确产品、品牌和包装需求。" },
      { title: "确认样品", body: "确认细节后再进入下一步。" },
      { title: "安排生产", body: "确认方案后推进生产。" },
      { title: "协调交付", body: "安排产品运往目标地点。" },
    ],
  },
  cta: {
    eyebrow: "从这里开始", title: "准备打造下一个美妆系列？",
    body: "告诉我们你的想法，从更多可能开始交流。",
    quote: "获取报价", contact: "联系我们",
  },
  footer: {
    tagline: "为引领未来的品牌提供用心打造的美妆产品。",
    products: "产品", business: "合作", company: "公司", language: "语言",
    nails: "穿戴甲", lashes: "假睫毛", wholesale: "批发合作",
    privateLabel: "自有品牌", oem: "OEM / ODM", about: "关于我们", contact: "联系",
    pending: "信息即将公布", rights: "保留所有权利。",
  },
  placeholder: {
    eyebrow: "即将推出", body: "此页面正在准备中，更多信息即将上线。", back: "返回首页",
    titles: {
      products: "产品", "products/press-on-nails": "穿戴甲", "products/false-eyelashes": "假睫毛",
      wholesale: "批发合作", "private-label": "自有品牌", "oem-odm": "OEM / ODM",
      about: "关于我们", contact: "联系", rfq: "获取报价",
    },
  },
};

export default zh;
