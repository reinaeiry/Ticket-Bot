// Side-channel between the Discord bot (started after the web server) and
// the web routes that need the Client instance to fetch channels + send
// messages. The bot's ready event calls setClient(); routes call getClient().

let client = null;
let prisma = null;

function setClient(c) { client = c; }
function getClient() { return client; }
function setPrisma(p) { prisma = p; }
function getPrisma() { return prisma; }

module.exports = { setClient, getClient, setPrisma, getPrisma };
