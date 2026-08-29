const response = await fetch("https://gamma-api.polymarket.com/markets?limit=50&closed=false&active=true");
if (!response.ok) throw new Error(`Polymarket returned HTTP ${response.status}`);
const data = await response.json();
if (!Array.isArray(data)) throw new Error("Polymarket returned an unexpected response");

const open = data.filter((market) => market?.active && !market.closed
  && market.outcomes?.includes("Yes") && market.outcomes?.includes("No")).slice(0, 20);
for (const market of open) {
  console.log(`${market.id} | ${String(market.question).slice(0, 70)} | ${market.outcomePrices} | end ${market.endDate}`);
}
