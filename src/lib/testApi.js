import { clobPriceHistoryAPI } from "./clobApi.js";

async function runClobFunc() {
	let marketId = "105104581338576429268357347529823581162598821797457643758239969314113345373365";
	let fidelity = 10;
	let eTs = Math.floor(Date.now() / 1000);
	let sTs = eTs - 2 * 24 * 60 * 60 ;
	await clobPriceHistoryAPI(marketId, sTs, eTs, fidelity);
}

await runClobFunc();
