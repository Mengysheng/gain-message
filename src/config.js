import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const DEFAULTS = {
  timezone: 'Asia/Shanghai',
  state_file: 'state/state.json',
  retention_days: 120,
  first_run: { mode: 'digest', limit: 5 },
  request: { timeout: 20000, retries: 2, concurrency: 3 },
  export: { enabled: true, dir: 'out' },
  email: {
    enabled: true,
    subject_prefix: '[通告雷达]',
    from_name: '通告雷达',
    mode: 'digest',
  },
};

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isObject(value) && isObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

function parseSmtpSecure(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

export function loadConfig(file = 'config.yaml', env = process.env) {
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`找不到配置文件：${fullPath}`);
  }

  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(fullPath, 'utf8')) || {};
  } catch (error) {
    throw new Error(`配置文件解析失败（YAML 语法错误？）：${error.message}`);
  }

  const config = deepMerge(DEFAULTS, raw);

  // 环境变量优先，方便 GitHub Actions 用 secrets 注入，避免密码进仓库
  const smtp = (config.email.smtp = config.email.smtp || {});
  if (env.SMTP_HOST) smtp.host = env.SMTP_HOST;
  if (env.SMTP_PORT) smtp.port = Number(env.SMTP_PORT);
  if (env.SMTP_SECURE) smtp.secure = parseSmtpSecure(env.SMTP_SECURE, smtp.secure);
  if (env.SMTP_USER) smtp.user = env.SMTP_USER;
  if (env.SMTP_PASS) smtp.pass = env.SMTP_PASS;
  if (env.MAIL_TO) config.email.to = env.MAIL_TO.split(/[,;，；\s]+/).filter(Boolean);
  if (env.MAIL_FROM) config.email.from = env.MAIL_FROM;
  if (env.MAIL_FROM_NAME) config.email.from_name = env.MAIL_FROM_NAME;

  const errors = [];
  const sites = Array.isArray(config.sites) ? config.sites : [];
  if (!sites.length) errors.push('config.yaml 里至少需要一个 sites 条目');

  const names = new Set();
  sites.forEach((site, index) => {
    const where = `sites[${index}]`;
    if (!site || !site.name) errors.push(`${where} 缺少 name`);
    const urls = Array.isArray(site?.urls) ? site.urls : site?.url ? [site.url] : [];
    if (!urls.length) errors.push(`${where} (${site?.name || '未命名'}) 缺少 url（或 urls 数组）`);
    for (const url of urls) {
      if (!/^https?:\/\//i.test(url)) {
        errors.push(`${where} (${site.name}) 的 url 必须以 http:// 或 https:// 开头：${url}`);
      }
    }
    if (!site?.list?.item) errors.push(`${where} (${site?.name || '未命名'}) 缺少 list.item 选择器`);
    if (site?.name) {
      if (names.has(site.name)) errors.push(`站点名重复：${site.name}（state 会串）`);
      names.add(site.name);
    }
  });

  if (config.email.enabled) {
    if (config.email.mode && !['digest', 'per_item'].includes(config.email.mode)) {
      errors.push("email.mode 只能是 'digest' 或 'per_item'");
    }
    if (config.email.to && !Array.isArray(config.email.to)) {
      config.email.to = [config.email.to];
    }
  }

  if (errors.length) {
    const error = new Error(`配置有问题：\n- ${errors.join('\n- ')}`);
    error.isConfigError = true;
    throw error;
  }

  config.email.from = config.email.from || config.email.smtp?.user;
  return config;
}

/** 真正要发信时才检查 SMTP 参数，这样 test / --no-email 不会被邮箱配置挡住 */
export function assertEmailConfig(config) {
  const problems = [];
  const smtp = config.email.smtp || {};
  if (!config.email.to || !config.email.to.length) {
    problems.push('email.to 为空（也可以设环境变量 MAIL_TO）');
  }
  if (!smtp.host) problems.push('缺少 smtp.host（或环境变量 SMTP_HOST）');
  if (!smtp.user) problems.push('缺少 smtp.user（或环境变量 SMTP_USER）');
  if (!smtp.pass) problems.push('缺少 smtp.pass（或环境变量 SMTP_PASS，QQ 邮箱要填授权码不是登录密码）');
  if (problems.length) {
    const error = new Error(`邮件配置不完整：\n- ${problems.join('\n- ')}`);
    error.isConfigError = true;
    throw error;
  }
}
