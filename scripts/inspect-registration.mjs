// Read-only check using the exact pinned official CLI implementation.
// Không in access token, client secret, nội dung chat hoặc response thô.
import { getTokenSilent, teamsDevPortalScopes, graphScopes } from '../node_modules/@microsoft/teams.cli/dist/auth/index.js';
import { fetchBot } from '../node_modules/@microsoft/teams.cli/dist/apps/tdp.js';

const botId = process.env.CLIENT_ID;
if (!botId) throw new Error('Thiếu CLIENT_ID trong .env');
const tdpToken = await getTokenSilent(teamsDevPortalScopes);
if (!tdpToken) throw new Error('Cần đăng nhập Teams CLI.');
const bot = await fetchBot(tdpToken, botId);
const graphToken = await getTokenSilent(graphScopes);
if (!graphToken) throw new Error('Không lấy được token Graph cho kiểm tra đăng ký.');
const url = new URL('https://graph.microsoft.com/v1.0/applications');
url.searchParams.set('$filter', `appId eq '${botId}'`);
url.searchParams.set('$select', 'appId,signInAudience');
const response = await fetch(url, { headers: { Authorization: `Bearer ${graphToken}` } });
if (!response.ok) throw new Error(`Graph returned HTTP ${response.status}`);
const app = (await response.json()).value?.[0];
console.log(JSON.stringify({
  botIdMatches: bot.botId === botId,
  endpointMatches: bot.messagingEndpoint === `${process.env.BOT_ENDPOINT}/api/messages`,
  configuredChannels: bot.configuredChannels,
  isSingleTenantReported: bot.isSingleTenant,
  signInAudience: app?.signInAudience,
  note: 'Readback only; does not prove Teams installation or end-to-end reply.',
}, null, 2));
