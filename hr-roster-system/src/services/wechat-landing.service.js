function normalizeWechatUrlScheme(value) {
  const raw = String(value || '').trim();
  if (!/^weixin:\/\/dl\/business\/\?t=[A-Za-z0-9_-]+$/.test(raw)) return '';
  return raw;
}

function renderPayslipLandingPage(value) {
  const urlScheme = normalizeWechatUrlScheme(value);
  if (!urlScheme) throw new Error('微信小程序 URL Scheme 未配置或格式无效');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <title>优企云工资条</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #13233f; background: radial-gradient(circle at 20% 10%,#d9edff 0,transparent 38%),linear-gradient(145deg,#f7fbff,#edf4ff); }
    main { width: min(100%,420px); padding: 36px 28px 30px; border: 1px solid rgba(78,139,230,.2); border-radius: 28px; background: rgba(255,255,255,.94); box-shadow: 0 24px 70px rgba(27,77,148,.16); text-align: center; }
    .mark { width: 72px; height: 72px; display: grid; place-items: center; margin: 0 auto 20px; border-radius: 22px; color: #fff; font-size: 30px; font-weight: 800; background: linear-gradient(145deg,#1469ff,#18b9d4); box-shadow: 0 14px 30px rgba(20,105,255,.25); }
    h1 { margin: 0; font-size: 28px; letter-spacing: .02em; }
    p { margin: 14px 0 26px; color: #62718a; font-size: 16px; line-height: 1.75; }
    a { display: block; width: 100%; padding: 15px 20px; border-radius: 14px; color: #fff; background: linear-gradient(100deg,#1469ff,#118fd7); text-decoration: none; font-size: 17px; font-weight: 700; box-shadow: 0 12px 24px rgba(20,105,255,.22); }
    small { display: block; margin-top: 18px; color: #8a98ad; line-height: 1.6; }
  </style>
</head>
<body>
  <main data-url-scheme="${urlScheme}">
    <div class="mark" aria-hidden="true">优</div>
    <h1>优企云工资条</h1>
    <p>正在为您打开优企云小程序。登录并完成本人身份校验后，即可查看本人工资条。</p>
    <a data-open-miniprogram href="${urlScheme}">打开优企云小程序</a>
    <small>若未自动打开，请点击上方按钮。链接不包含员工身份及工资信息。</small>
  </main>
  <script src="/wx-payslip.js" defer></script>
</body>
</html>`;
}

module.exports = {
  normalizeWechatUrlScheme,
  renderPayslipLandingPage
};
