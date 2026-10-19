/*
 * David's fields, from his Upwork profile and his own list (2026-10-14). The profile-fit gate
 * (profileFit.ts) uses them to keep jobs outside his work away from the ranking, alerts and auto-drafts.
 *
 *   mine  - his fields: a matching Upwork skill tag or title phrase is evidence the job is his.
 *   never - work he does not do: a matching tag, title phrase or Upwork category is evidence it isn't.
 *
 * Tags are Upwork skill names, compared whole after lower-casing ("~stem" = tag contains the stem).
 * Settings → Your fields adds phrases to either list; his synced Upwork profile skills count as "mine".
 */

export interface FieldDef {
  label: string;
  tags: string[];
  title?: RegExp;
}

export interface FieldSpec {
  mine: FieldDef[];
  never: FieldDef[];
  /** Upwork top-level categories that are never his work unless the job also shows one of his fields. */
  offCategories: Record<string, string>;
  /** Upwork subcategories: outside his work (like offCategories), or one of his fields (like a title match). */
  offSubcategories: Record<string, string>;
  mySubcategories: Record<string, string>;
}

export const ACCOUNTING_SYSTEMS = "AI accounting & finance systems";

export const MY_FIELDS: FieldDef[] = [
  // First: its title pattern is specific, and "automation" alone would otherwise match the automation field.
  {
    label: ACCOUNTING_SYSTEMS,
    tags: ["accounting software", "ai accounting", "financial automation", "accounting automation", "erp integration", "erp software", "financial reporting automation",
      "fp&a", "financial dashboard", "quickbooks api", "xero api", "netsuite integration", "audit analytics"],
    title: /\b((ai|automat\w*|software|systems?|platforms?|apps?|saas|tools?|dashboards?|integrations?|agents?)[- ](for |powered )?(accounting|bookkeeping|finance|fp&a|tax|audit|invoic\w*|reconciliation)|(accounting|bookkeeping|finance|fp&a|tax|audit|invoice|reconciliation|erp)[- ](ai|automation|software|systems?|platform|app|saas|tools?|dashboards?|integration|agents?|engine))\b/i,
  },
  {
    label: "AI agents & LLM apps",
    tags: ["artificial intelligence", "ai agent development", "llm agent development", "ai agents", "ai agent", "ai agent orchestration", "agentic workflows", "agentic ai",
      "ai chatbot", "chatbot", "chatbot development", "conversational ai", "llm prompt", "prompt engineering", "large language model", "llm api integration", "llm", "openai api",
      "chatgpt", "chatgpt api integration", "claude", "anthropic claude", "gemini", "langchain", "langgraph", "llamaindex", "crewai", "autogen", "retrieval augmented generation",
      "rag", "vector database", "pinecone", "model context protocol", "mcp", "ai development", "ai implementation", "ai app development", "ai integration",
      "ai integration deliverables", "ai automation", "generative ai", "generative ai software", "ai model training", "ai model integration", "ai strategy", "ai consulting",
      "hugging face", "fine-tuning", "openai codex", "ai bot", "ai trading", "ai agent development tools", "ai chatbot development tools",
      "ai security", "llm security", "ai guardrails", "responsible ai"],
    title: /\b(llm|gpt|openai|chatgpt|claude|anthropic|langchain|langgraph|llamaindex|crewai|autogen|rag|ai agents?|agentic|chat ?bots?|conversational ai|prompt engineer\w*|mcp|generative ai|gen ?ai|ai\/ml|ai (engineer|developer|integration|automation|assistant|app|solution|solutions|workflow|platform|saas|implementation|specialist|expert|consultant|transformation|tutor|security|guardrails)|(secure|private) llms?|llm (security|guardrails))\b/i,
  },
  {
    label: "ML, deep learning & computer vision",
    tags: ["machine learning", "deep learning", "neural network", "pytorch", "tensorflow", "keras", "scikit-learn", "computer vision", "opencv", "image processing",
      "object detection", "image recognition", "image segmentation", "ocr", "optical character recognition", "natural language processing", "nlp", "text classification",
      "sentiment analysis", "speech recognition", "recommendation system", "time series analysis", "predictive modeling", "predictive analytics", "mlops", "aiops", "llmops", "model deployment", "amazon sagemaker", "vertex ai", "mlflow", "kubeflow",
      "yolo", "bert", "machine learning model", "~machine learning", "~deep learning", "~computer vision"],
    title: /\b(machine learning|ml|deep learning|neural net\w*|pytorch|tensorflow|computer vision|opencv|ocr|nlp|natural language|object detection|fac(e|ial) recognition|liveness|deepfakes?|speech.to.text|speech recognition|image (recognition|classification|segmentation)|fine.?tun\w*|(model|ai|ml|llm) (training|deployment|serving|inference|infrastructure|ops)|mlops|aiops|llmops|recommend(er|ation) (system|engine)|predictive model\w*|forecasting model)\b/i,
  },
  {
    label: "Data science & data engineering",
    tags: ["data science", "data analysis", "data analytics", "data visualization", "statistical analysis", "statistics", "python", "r", "rstudio", "r shiny", "shiny",
      "jupyter notebook", "pandas", "numpy", "sql", "postgresql", "mysql", "bigquery", "snowflake", "etl", "etl pipeline", "data engineering", "apache spark", "pyspark",
      "airflow", "dbt", "data mining", "data scraping", "web scraping", "scrapy", "selenium", "tableau", "microsoft power bi", "power bi", "looker studio", "dashboard",
      "streamlit", "plotly", "~data science", "sales analytics", "sales analysis", "sales forecasting", "business intelligence", "forecasting", "excel vba"],
    title: /\b(data scien\w*|data analy\w*|data engineer\w*|analytics|python|sql|postgres\w*|etl|bigquery|snowflake|power ?bi|tableau|looker|dashboards?|statistic\w*|kaggle|scrap(er|ers|ing)|crawler|rstudio|r (programming|developer|shiny)|sales (analy\w*|forecast\w*|data|reporting|dashboards?)|business intelligence|forecast\w*)\b/i,
  },
  {
    label: "Algorithmic trading & quant",
    tags: ["algorithmic trading", "trading automation", "trading strategy", "automated trading", "quantitative analysis", "quantitative finance", "quantitative research",
      "backtesting", "cryptocurrency trading", "crypto trading", "binance", "bybit", "metatrader", "metatrader 4", "metatrader 5", "mql4", "mql5", "tradingview",
      "pine script", "interactive brokers", "quantconnect", "ccxt", "trading bot", "financial modeling", "~algorithmic trading"],
    title: /\b(algo(rithmic)? ?trad\w*|quant\w*|trading (bots?|strateg\w*|systems?|algorithms?|automation|platform)|crypto (bots?|trading)|backtest\w*|binance|bybit|metatrader|mt[45]|mql[45]?|pine ?script|tradingview|interactive brokers|ibkr|quantconnect|market making|arbitrage)\b/i,
  },
  {
    label: "Voice agents, automation & bots",
    tags: ["vapi", "retell ai", "retell", "voice ai", "voice agent", "ai voice agent", "twilio", "telnyx", "elevenlabs", "n8n", "make.com", "zapier", "gohighlevel", "highlevel",
      "automation", "workflow automation", "business process automation", "crm automation", "api integration", "api", "rest api", "webhook", "airtable",
      "telegram bot", "telegram api", "discord bot", "bot development"],
    title: /\b(vapi|retell|voice (ai|agents?|bots?|assistant)|ai (receptionist|caller|calling)|twilio|telnyx|elevenlabs|n8n|make\.com|zapier|go ?high ?level|ghl|automat\w+|workflows?|integrations?|webhooks?|airtable|telegram bots?|discord bots?|bots?)\b/i,
  },
  {
    label: "AI marketing & ads",
    tags: ["google ads", "google ads adwords", "meta ads", "facebook ads", "facebook advertising", "instagram ads", "linkedin ads", "tiktok ads", "ppc", "pay per click",
      "ppc campaign setup and management", "paid media", "paid advertising", "performance marketing", "search engine optimization", "seo", "technical seo", "on-page seo",
      "local seo", "generative engine optimization", "answer engine optimization", "google analytics", "google analytics 4", "ga4", "google tag manager", "conversion tracking",
      "conversion rate optimization", "marketing automation", "digital marketing", "ai content creation", "ai marketing", "growth hacking", "digital marketing strategy",
      "search engine marketing strategy"],
    title: /\b(google ads|meta ads|facebook ads|instagram ads|tiktok ads|linkedin ads|ads|ppc|paid (ads|media|social|search)|performance marketing|media buy\w*|seo|geo|aeo|generative engine|answer engine|google analytics|ga4|tag manager|gtm|conversion (tracking|rate)|cro|marketing automation|growth market\w*|ai marketing|digital marketing)\b/i,
  },
  {
    label: "Web & app development",
    tags: ["web development", "full stack development", "full-stack development", "front-end development", "back-end development", "web application", "web app",
      "javascript", "typescript", "react", "react native", "next.js", "node.js", "express.js", "nestjs", "vue.js", "angular", "html", "html5", "css", "tailwind css",
      "supabase", "firebase", "mongodb", "redis", "graphql", "fastapi", "flask", "django", "mobile app development", "android app development", "ios development",
      "saas", "saas development", "mvp development", "api development", "backend development", "frontend development", "progressive web app", "website", "web design",
      "hipaa", "hipaa compliance", "soc 2", "soc 2 compliance", "gdpr", "gdpr compliance", "api security", "rest api development", "figma to code", "figma to react"],
    title: /\b(full.?stack|front.?end|back.?end|web (apps?|application|developer|development|platform)|mobile apps?|react( native)?|next\.?js|node\.?js|typescript|javascript|express|nestjs|fastapi|django|flask|supabase|firebase|saas|mvp|(software|web|app|backend|frontend|python|javascript|react|node|mobile|api|ai|ml|full.?stack) (developer|engineer|programmer)|hipaa|soc ?2|gdpr|figma to (code|react|next\.?js|app|webflow|saas|web)|(design|figma) (and|&|to) (build|develop\w*|launch)|ui\/ux (and|&) (development|developer))\b/i,
  },
  {
    label: "Blockchain & smart contracts",
    tags: ["blockchain", "smart contract", "smart contracts", "solidity", "web3", "web3.js", "ethers.js", "ethereum", "hardhat", "foundry", "solana", "defi",
      "dapp development", "blockchain development", "~smart contract"],
    title: /\b(blockchain|smart contracts?|solidity|web3|ethereum|evm|solana|defi|dapps?|tokenomics|nft marketplace|crypto(currency)? (wallet|exchange|platform))\b/i,
  },
  {
    label: "AI video, image & 3D",
    tags: ["ai video generation", "ai-generated video", "ai video", "ai video editing", "ai image generation", "ai-generated image", "ai art", "ai animation tools",
      "ai animation", "midjourney", "stable diffusion", "dall-e", "runway", "runwayml", "higgsfield", "heygen", "synthesia", "kling ai", "veo", "comfyui", "ai avatar",
      "ai ugc", "ai video generation and editing services", "ai video generation and editing tools", "ai video generation and editing deliverables", "ai-generated video",
      "3d modeling", "3d model", "3d design", "3d animation", "3d rendering", "3d art", "3d texturing", "3d printing model", "blender", "cinema 4d", "autodesk 3ds max",
      "3ds max", "autodesk maya", "maya", "zbrush", "substance painter", "keyshot", "3d configurator", "product configurator", "three.js", "gaussian splatting"],
    title: /\b(ai[- ]?(generated )?(videos?|images?|art|avatars?|ugc|animation|influencers?|models?|photos?|content)|text.?to.?(video|image)|midjourney|stable diffusion|comfyui|higgsfield|heygen|synthesia|runway|kling|veo ?3?|sora|dall.?e|lora|3d (anima\w*|model\w*|render\w*|artists?|design\w*|configurators?|visuali[sz]\w*|product)|blender|cinema ?4d|c4d|3ds ?max|zbrush|keyshot|product configurators?)\b/i,
  },
  {
    // Python + AI data work: dedup / record linkage / entity resolution, cleaning and migrations (CRM data included).
    label: "Data processing, cleaning & record linkage",
    tags: ["data cleaning", "data cleansing", "data deduplication", "deduplication", "record linkage", "entity resolution", "data matching",
      "fuzzy matching", "data migration", "data processing", "data transformation", "data normalization", "data quality", "master data management",
      "data scrubbing", "data wrangling", "crm data migration"],
    title: /\b(de-?dup\w*|duplicates?|record linkage|entity resolution|fuzzy match\w*|data (cleaning|cleansing|cleanup|clean-up|processing|migration|matching|normali[sz]ation|transformation|quality|scrubbing|wrangling|merge|merging)|merg(e|ing) (records|contacts|duplicates|accounts|leads)|(crm|contact|lead|customer) (data )?(cleanup|clean-up|dedup\w*)|master data)\b/i,
  },
  {
    label: "Cloud & DevOps",
    tags: ["devops", "aws", "amazon web services", "google cloud platform", "google cloud", "microsoft azure", "azure", "docker", "kubernetes", "terraform", "ci/cd",
      "github actions", "serverless"],
    title: /\b(devops|aws|azure|gcp|google cloud|docker|kubernetes|k8s|terraform|ci\/cd|serverless|cloud (engineer|architect|infrastructure)|(deployment|platform|infrastructure|devsecops) engineer|sre)\b/i,
  },
];

/** 3D skill tags (his work since 2026-10-15) - they don't count when the title names a game-development role. */
export const THREE_D_TAG = /\b(3d|blender|cinema 4d|3ds max|maya|zbrush|substance painter|keyshot|configurator|three\.js|gaussian splatting)\b/;

export const NEVER_FIELDS: FieldDef[] = [
  {
    label: "Game development",
    tags: ["unreal engine", "unreal engine 5", "unity", "unity 3d", "unity3d", "game development", "game development skills", "game design", "level design", "godot",
      "game art", "roblox", "gameplay programming", "technical art", "technical artist"],
    title: /\b(unreal|unity( ?3d| developer| engineer| game)?|godot|game ?(dev\w*|design\w*|programmer|artist|engine)|gameplay|level design\w*|technical artist|tech artist|roblox|fortnite|minecraft|ue[45]|metahuman)\b/i,
  },
  {
    label: "Legal",
    tags: ["trademark law", "trademark prosecution", "trademark registration", "trademark search", "trademark consulting", "legal", "legal consulting", "legal writing",
      "legal research", "contract law", "contract drafting", "intellectual property law", "patent law", "litigation", "paralegal services", "immigration law",
      "business law", "corporate law"],
    title: /\b(trademarks?|attorneys?|lawyers?|paralegal|legal (counsel|advisor|assistant|research\w*|writer)|patent (attorney|agent|search)|litigation|solicitor|notary|uspto)\b/i,
  },
  {
    label: "Admin support",
    tags: ["data entry", "virtual assistance", "virtual assistant", "administrative support", "executive support", "email management", "calendar management",
      "administrative assistant", "personal assistant", "order processing", "typing"],
    title: /\b(virtual assistant|data entry|executive assistant|admin(istrative)? (assistant|support)|personal assistant|operations (manager|assistant)|office manager)\b/i,
  },
  {
    label: "Customer service",
    tags: ["customer support", "customer service", "chat support", "phone support", "email support", "customer experience"],
    title: /\b(customer (support|service|success|care)|support (agent|representative|specialist)|call cent(er|re)|chat support|live chat agent)\b/i,
  },
  {
    label: "Writing & editing",
    tags: ["proofreading", "copy editing", "copyediting", "editing and proofreading", "editing", "line editing", "~translation", "transcription", "ghostwriting",
      "creative writing", "fiction writing", "book writing", "scriptwriting", "script writing", "copywriting", "content writing", "article writing", "blog writing",
      "technical writing", "academic writing", "resume writing", "grant writing", "seo writing", "writing"],
    title: /\b(proofread\w*|copy ?edit\w*|copywrit\w*|ghostwrit\w*|content writ\w*|blog (writers?|posts?)|article writ\w*|scriptwrit\w*|script writers?|technical writers?|translat\w*|transcri\w*|(book|line|developmental|copy|content|academic) editors?|writers?|resume writ\w*|grant writ\w*|guest posts?|link (insertion|building))\b/i,
  },
  {
    label: "Design & photo editing",
    tags: ["logo design", "graphic design", "print design", "photo retouching", "photo editing", "photo manipulation", "adobe photoshop", "adobe illustrator", "illustration",
      "brand identity design", "brand identity and guidelines", "packaging design", "t-shirt design", "2d animation", "motion graphics", "adobe after effects",
      "visual effects", "infographic", "presentation design", "canva", "banner design", "flyer design", "book cover design", "character design",
      "architectural rendering", "interior design"],
    title: /\b(logos?|graphic design\w*|photoshop|retouch\w*|compositing|illustrat(or|ors|ion|ions)|brand identity|identity design\w*|packaging design|print design|t-?shirts?|2d anima\w*|motion graphics?|after effects|banners?|flyers?|book covers?|character design|canva|infographics?|presentation design|interior design)\b/i,
  },
  {
    label: "Video editing",
    tags: ["video editing", "video editor", "video post-editing", "adobe premiere pro", "davinci resolve", "final cut pro", "capcut", "podcast editing", "audio editing",
      "youtube editing", "video production", "videography", "color grading"],
    title: /\b(video edit\w*|podcast edit\w*|youtube edit\w*|audio edit\w*|premiere pro|davinci|final cut|capcut|videograph\w*|video production|colou?r grad\w*|reels editor|shorts editor)\b/i,
  },
  {
    label: "Sales & PR roles",
    tags: ["sales", "sales development", "appointment setting", "cold calling", "telemarketing", "outbound sales", "inside sales", "b2b sales", "high-ticket closing",
      "high ticket closing", "sales closing", "business development", "ai product sales", "account management", "public relations", "media relations",
      "reputation management", "yelp management", "influencer marketing", "fundraising"],
    title: /\b(sales (rep\w*|agents?|executive|closers?|associate|manager|consultant|specialist|development)|appointment sett\w*|cold call\w*|telemarket\w*|sdr|bdr|closers?|setters?|business development (rep\w*|manager|executive|associate)|account executive|publicist|public relations|pr (manager|specialist)|reputation management|fundrais\w*)\b/i,
  },
  {
    label: "Accounting & tax",
    tags: ["bookkeeping", "accounting", "tax preparation", "tax law", "cpa", "corporate tax", "quickbooks online", "quickbooks", "xero", "payroll", "financial audit",
      "accounts payable", "accounts receivable", "tax return preparation"],
    title: /\b(bookkeep\w*|accountants?|cpa|tax (prep\w*|returns?|strateg\w*|filing|advis\w*|planning)|payroll|quickbooks|xero|(financial|tax|internal) audit\w*|accounts (payable|receivable)|fractional cfo)\b/i,
  },
  {
    label: "CAD & architecture",
    tags: ["autocad", "solidworks", "revit", "cad", "computer-aided design", "3d cad", "architectural design", "architectural drafting", "mechanical engineering",
      "civil engineering", "structural engineering", "electrical engineering", "pcb design", "sketchup", "fusion 360"],
    title: /\b(autocad|solidworks|revit|cad|sketchup|fusion 360|architect(ural)? (drawings?|drafting|plans?|render\w*|design)|draft(er|sman|ing)|mechanical engineer\w*|civil engineer\w*|structural engineer\w*|electrical engineer\w*|pcb|floor ?plans?)\b/i,
  },
  {
    label: "IT support & networking",
    tags: ["network administration", "it support", "technical support", "helpdesk", "active directory", "cisco", "windows server", "iso 27001", "itil"],
    title: /\b(it support|help ?desk|tech(nical)? support|network (admin\w*|engineer|technician)|system administrator|sysadmin|active directory|cisco|iso ?27001|it technician|desktop support)\b/i,
  },
];

export const OFF_CATEGORIES: Record<string, string> = {
  "Legal": "Legal",
  "Customer Service": "Customer service",
  "Admin Support": "Admin support",
  "Translation": "Writing & editing",
  "Engineering & Architecture": "CAD & architecture",
  "Accounting & Consulting": "Accounting & consulting",
};

export const OFF_SUBCATEGORIES: Record<string, string> = {
  "Game Design & Development": "Game development",
  "Video & Animation": "Video editing",
  "Graphic, Editorial & Presentation Design": "Design & photo editing",
  "Branding & Logo Design": "Design & photo editing",
  "Art & Illustration": "Design & photo editing",
  "Photography": "Design & photo editing",
  "Lead Generation & Telemarketing": "Sales & PR roles",
  "Marketing, PR & Brand Strategy": "Sales & PR roles",
  "Virtual Assistance": "Admin support",
  "Project Management": "Admin support",
  "Market Research & Product Reviews": "Admin support",
  "Data Entry & Transcription Services": "Admin support",
  "Recruiting & Human Resources": "Admin support",
  "Corporate & Contract Law": "Legal",
  "Editing & Proofreading Services": "Writing & editing",
  "Sales & Marketing Copywriting": "Writing & editing",
  "Content Writing": "Writing & editing",
  "Professional & Business Writing": "Writing & editing",
  "Translation & Localization Services": "Writing & editing",
  "Accounting & Bookkeeping": "Accounting & tax",
  "Customer Service & Tech Support": "Customer service",
  "Electrical & Electronic Engineering": "CAD & architecture",
  "Network & System Administration": "IT support & networking",
  "Information Security & Compliance": "IT support & networking",
};

export const MY_SUBCATEGORIES: Record<string, string> = {
  "AI & Machine Learning": "ML, deep learning & computer vision",
  "AI Apps & Integration": "AI agents & LLM apps",
  "Data Mining & Management": "Data science & data engineering",
  "Data Analysis & Testing": "Data science & data engineering",
  "Data Extraction/ETL": "Data science & data engineering",
  "Data Visualization": "Data science & data engineering",
  "Web Development": "Web & app development",
  "Mobile Development": "Web & app development",
  "Desktop Application Development": "Web & app development",
  "Ecommerce Development": "Web & app development",
  "Other - Software Development": "Web & app development",
  "Scripts & Utilities": "Voice agents, automation & bots",
  "Blockchain, NFT & Cryptocurrency": "Blockchain & smart contracts",
  "DevOps & Solution Architecture": "Cloud & DevOps",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const normTag = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

function phraseField(label: string, phrases: string[]): FieldDef | null {
  const clean = phrases.map((p) => p.trim()).filter(Boolean);
  if (!clean.length) return null;
  return { label, tags: clean.map(normTag), title: new RegExp(`\\b(${clean.map(escape).join("|")})\\b`, "i") };
}

/** Built-in lists + Settings → Your fields + the skills on his Upwork profile. */
export function buildFieldSpec(overrides?: { never?: string[]; alsoMine?: string[] } | null, profileSkills: string[] = []): FieldSpec {
  const mine = [...MY_FIELDS];
  const extraMine = phraseField("Your list", overrides?.alsoMine ?? []);
  if (extraMine) mine.unshift(extraMine);
  if (profileSkills.length) mine.push({ label: "Your Upwork profile skills", tags: profileSkills.map(normTag) });
  const never = [...NEVER_FIELDS];
  const extraNever = phraseField("Your never list", overrides?.never ?? []);
  if (extraNever) never.unshift(extraNever);
  return { mine, never, offCategories: OFF_CATEGORIES, offSubcategories: OFF_SUBCATEGORIES, mySubcategories: MY_SUBCATEGORIES };
}

export const DEFAULT_FIELD_SPEC = buildFieldSpec();
