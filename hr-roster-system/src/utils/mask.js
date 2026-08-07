function maskPhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

function maskIdCard(idCardNo) {
  if (!idCardNo) return '';
  const value = String(idCardNo);
  if (value.length < 8) return value;
  return value.replace(/^(.{6}).+(.{4})$/, '$1********$2');
}

function maskBankCard(bankCardNo) {
  if (!bankCardNo) return '';
  const value = String(bankCardNo);
  if (value.length < 8) return value;
  return `${value.slice(0, 4)} **** **** ${value.slice(-4)}`;
}

module.exports = {
  maskPhone,
  maskIdCard,
  maskBankCard
};
