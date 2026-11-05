import { api } from './api.js';
import { toman } from './ui.js';

const authority = new URLSearchParams(location.search).get('authority') ?? '';
const finish = async (pay) => {
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  const res = await api.post('/api/mock-gateway/complete', { authority, pay });
  location.href = res.redirect;
};
api.get(`/api/mock-gateway/${encodeURIComponent(authority)}`)
  .then((d) => (document.getElementById('amount').textContent = toman(d.amount)))
  .catch(() => (document.getElementById('amount').textContent = 'تراکنش نامعتبر'));
document.getElementById('pay').onclick = () => finish(true);
document.getElementById('cancel').onclick = () => finish(false);
