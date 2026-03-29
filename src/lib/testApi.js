import { clobPriceHistoryAPI } from "./clobApi.js";
import { fetchFamilies } from "./gammaApi.js";

async function runClobFunc() {
	let marketId = tokenId; 
	let fidelity = 2;
	let eTs = Math.floor(Date.now() / 1000);
	let sTs = eTs - 2 * 24 * 60 * 60 ;
	await clobPriceHistoryAPI(marketId, sTs, eTs, fidelity);
}

async function runGammaFunc() {
	let res = await fetchFamilies();
	console.log(res[0].markets);
	return JSON.parse(res[0].markets[0].clobTokenIds)[0];
}

let tokenId = await runGammaFunc();
await runClobFunc();
