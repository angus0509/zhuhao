/**
 * 腾讯云身份证OCR识别服务
 * 支持两种认证方式（自动选择）:
 *   1. CVM 实例 CAM 角色（推荐）— 自动从 metadata 获取临时凭证，无需配置密钥
 *   2. 环境变量 TENCENT_SECRET_ID + TENCENT_SECRET_KEY（备选）
 * API文档: https://cloud.tencent.com/document/product/866/33527
 */
// OCR SDK 不是主业务启动条件；未安装时保留接口可用并返回可诊断错误，
// 避免一次 OCR 依赖缺失导致整个 HR 系统容器反复重启。
let tencentcloud = null;
try {
  tencentcloud = require('tencentcloud-sdk-nodejs');
} catch (_error) {
  tencentcloud = null;
}
const OcrClient = tencentcloud?.ocr?.v20181119?.Client;
const http = require('http');

const REGION = process.env.TENCENT_OCR_REGION || 'ap-shanghai';
const METADATA_BASE = 'http://metadata.tencentyun.com/latest/meta-data';

// 缓存的临时凭证
let cachedCredentials = null;
let credentialExpireAt = 0;

/**
 * 从 CVM metadata 获取临时凭证（需要实例已绑定 CAM 角色）
 */
function getCredentialsFromMetadata() {
  return new Promise((resolve, reject) => {
    // 1. 获取角色名称
    http.get(`${METADATA_BASE}/cam/security-credentials/`, (res) => {
      let roleName = '';
      res.on('data', (chunk) => (roleName += chunk));
      res.on('end', () => {
        roleName = roleName.trim();
        if (!roleName || roleName.includes('404')) {
          return reject(new Error('NO_CAM_ROLE'));
        }

        // 2. 获取临时凭证
        http.get(`${METADATA_BASE}/cam/security-credentials/${roleName}`, (res2) => {
          let data = '';
          res2.on('data', (chunk) => (data += chunk));
          res2.on('end', () => {
            try {
              const creds = JSON.parse(data);
              if (creds.Code !== 'Success') {
                return reject(new Error('METADATA_ERROR: ' + (creds.Message || data)));
              }
              resolve({
                secretId: creds.TmpSecretId,
                secretKey: creds.TmpSecretKey,
                token: creds.Token,
                expireAt: creds.ExpiredTime * 1000 // 转毫秒
              });
            } catch (e) {
              reject(new Error('METADATA_PARSE_ERROR: ' + e.message));
            }
          });
        }).on('error', reject);
      });
    }).on('error', reject);
  });
}

/**
 * 获取客户端（自动选择认证方式）
 */
async function getClient() {
  if (!OcrClient) {
    const err = new Error('OCR SDK 未安装，请安装 tencentcloud-sdk-nodejs 后再启用身份证识别');
    err.code = 'OCR_SDK_MISSING';
    throw err;
  }
  let credential;

  // 方式1: 尝试从 CVM metadata 获取临时凭证
  try {
    // 检查缓存是否有效（提前 5 分钟刷新）
    if (cachedCredentials && Date.now() < credentialExpireAt - 300000) {
      credential = {
        secretId: cachedCredentials.secretId,
        secretKey: cachedCredentials.secretKey,
        token: cachedCredentials.token
      };
    } else {
      const creds = await getCredentialsFromMetadata();
      cachedCredentials = creds;
      credentialExpireAt = creds.expireAt;
      credential = {
        secretId: creds.secretId,
        secretKey: creds.secretKey,
        token: creds.token
      };
      console.log('[OCR] 使用 CVM 实例角色凭证，有效期至:', new Date(creds.expireAt).toISOString());
    }
  } catch (e) {
    // 方式2: 回退到环境变量
    const secretId = process.env.TENCENT_SECRET_ID;
    const secretKey = process.env.TENCENT_SECRET_KEY;

    if (!secretId || !secretKey) {
      const err = new Error('OCR服务未配置：请给CVM实例绑定CAM角色，或在环境变量中设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY');
      err.code = 'OCR_NOT_CONFIGURED';
      throw err;
    }
    credential = { secretId, secretKey };
    console.log('[OCR] 使用环境变量凭证');
  }

  return new OcrClient({
    credential,
    region: REGION,
    profile: {
      httpProfile: { endpoint: 'ocr.tencentcloudapi.com' }
    }
  });
}

/**
 * 身份证正面识别
 * @param {string} imageBase64 - base64 编码的图片（可含 data:image 前缀）
 * @returns {Promise<Object>} 结构化识别结果
 */
async function recognizeIdCard(imageBase64) {
  const client = await getClient();

  // 去掉 data:image/xxx;base64, 前缀
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  const params = {
    ImageBase64: base64Data,
    CardSide: 'FRONT'
  };

  const result = await client.IDCardOCR(params);

  return {
    name: result.Name || '',
    gender: result.Sex === '男' ? 1 : (result.Sex === '女' ? 2 : 0),
    nation: result.Nation || '',
    birth: result.Birth || '',
    address: result.Address || '',
    idCardNo: result.IdNum || '',
    authority: result.Authority || '',
    validDate: result.ValidDate || '',
    advancedInfo: result.AdvancedInfo || ''
  };
}

module.exports = { recognizeIdCard };
