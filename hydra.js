/** @param {NS} ns */
export async function main(ns) {
    // --- CONFIGURATION ---
    const CONFIG = {
        stealPercent: 0.67,
        reserveHomeRam: 2048,
        minSecurityThresh: 5,
        minMoneyThresh: 0.90,
        maxTargets: 200,
        xpTarget: "joesguns",
        refreshRate: 200 // Refresh HUD every 200ms
    };

    const SCRIPTS = {
        hack: "h.js",
        grow: "g.js",
        weak: "w.js"
    };

    // --- SETUP ---
    const files = Object.values(SCRIPTS);
    const code = [
        `/** @param {NS} ns */ export async function main(ns) { await ns.hack(ns.args[0]) }`,
        `/** @param {NS} ns */ export async function main(ns) { await ns.grow(ns.args[0]) }`,
        `/** @param {NS} ns */ export async function main(ns) { await ns.weaken(ns.args[0]) }`
    ];
    for (let i = 0; i < files.length; i++) {
        if (!ns.fileExists(files[i])) await ns.write(files[i], code[i], "w");
    }

    ns.disableLog("ALL");
    if (ns.ui && ns.ui.openTail) ns.ui.openTail(); else ns.tail();

    // --- HELPER FUNCTIONS ---

    function getRamServers() {
        let hosts = ["home"];
        let scanList = ["home"];
        let visited = new Set(["home"]);
        while(scanList.length > 0) {
            let current = scanList.pop();
            let next = ns.scan(current);
            for (let server of next) {
                if (!visited.has(server)) {
                    visited.add(server);
                    hosts.push(server);
                    scanList.push(server);
                }
            }
        }
        return hosts.filter(s => ns.hasRootAccess(s) && ns.getServerMaxRam(s) > 0);
    }

    async function distributeRun(script, threads, target, ramServers) {
        if (threads <= 0) return true;
        let threadsLeft = threads;
        let scriptRam = ns.getScriptRam(script);
        let scheduledSomething = false;

        ramServers.sort((a, b) => 
            (ns.getServerMaxRam(b) - ns.getServerUsedRam(b)) - 
            (ns.getServerMaxRam(a) - ns.getServerUsedRam(a))
        );

        for (let host of ramServers) {
            if (threadsLeft <= 0) break;
            let maxRam = ns.getServerMaxRam(host);
            let usedRam = ns.getServerUsedRam(host);
            if (host === "home") maxRam = Math.max(0, maxRam - CONFIG.reserveHomeRam);
            
            let freeRam = maxRam - usedRam;
            let possibleThreads = Math.floor(freeRam / scriptRam);

            if (possibleThreads > 0) {
                let runThreads = Math.min(threadsLeft, possibleThreads);
                if (host !== "home") await ns.scp(script, host);
                ns.exec(script, host, runThreads, target);
                threadsLeft -= runThreads;
                scheduledSomething = true;
            }
        }
        return scheduledSomething;
    }

    // --- NEW: NETWORK SCANNER ---
    // Scans all servers to see what is ACTUALLY running right now
    function getNetworkStatus(ramServers) {
        let stats = {}; // Key: Target, Value: { h:0, g:0, w:0 }

        for (let server of ramServers) {
            let running = ns.ps(server);
            for (let process of running) {
                if ([SCRIPTS.hack, SCRIPTS.grow, SCRIPTS.weak].includes(process.filename)) {
                    let target = process.args[0];
                    if (!stats[target]) stats[target] = { h:0, g:0, w:0 };
                    
                    if (process.filename === SCRIPTS.hack) stats[target].h += process.threads;
                    if (process.filename === SCRIPTS.grow) stats[target].g += process.threads;
                    if (process.filename === SCRIPTS.weak) stats[target].w += process.threads;
                }
            }
        }
        return stats;
    }

    // --- UI RENDERING ---
    function printDashboard(activeStats, totalRam, usedRam) {
        ns.clearLog();
        
        // 1. RAM Bar
        let pct = (usedRam / totalRam) * 100;
        let bars = Math.round((pct / 100) * 25);
        let progressBar = "█".repeat(bars) + "░".repeat(25 - bars);
        
        ns.print(` HYDRA V8  [${progressBar}] ${pct.toFixed(1)}%`);
        ns.print(` RAM LOAD:  ${ns.formatRam(usedRam)} / ${ns.formatRam(totalRam)}`);
        ns.print("━".repeat(50));
        
        // 2. Target List (Sorted by thread count)
        // Formatting: Target (15) | Tasks (15) | Security (8) | Money (8)
        ns.printf(" %-15s | %-15s | %-8s | %-8s", "TARGET", "ACTIVITY", "SEC", "MONEY");
        ns.print("─".repeat(50));

        let targets = Object.keys(activeStats).sort((a, b) => {
            let totalA = activeStats[a].h + activeStats[a].g + activeStats[a].w;
            let totalB = activeStats[b].h + activeStats[b].g + activeStats[b].w;
            return totalB - totalA;
        });

        for (let t of targets) {
            let s = activeStats[t];
            let activity = [];
            if (s.h > 0) activity.push(`💸 ${ns.formatNumber(s.h)}`);
            if (s.g > 0) activity.push(`🌱 ${ns.formatNumber(s.g)}`);
            if (s.w > 0) activity.push(`📉 ${ns.formatNumber(s.w)}`);
            
            let sec = (ns.getServerSecurityLevel(t) - ns.getServerMinSecurityLevel(t)).toFixed(1);
            let mon = Math.round((ns.getServerMoneyAvailable(t) / ns.getServerMaxMoney(t)) * 100);

            // Conditional Coloring (Green if good, Red if bad)
            // Note: We can't do real color in print(), so we use indicators
            let secStr = sec > 0 ? `+${sec}` : "OK";
            let monStr = mon + "%";

            ns.printf(" %-15s | %-15s | %-8s | %-8s", 
                t, activity.join(" "), secStr, monStr);
        }

        if (targets.length === 0) ns.print(" 💤 Waiting for next batch...");
    }

    // --- MAIN LOOP ---
    while (true) {
        let playerLevel = ns.getHackingLevel();
        let ramServers = getRamServers();
        
        // 1. SMART TARGETING
        let targets = ramServers
            .filter(s => ns.getServerMaxMoney(s) > 0 && s !== "home")
            .filter(s => ns.getServerRequiredHackingLevel(s) <= playerLevel)
            .sort((a, b) => (ns.getServerMaxMoney(b) / ns.getHackTime(b)) - (ns.getServerMaxMoney(a) / ns.getHackTime(a)))
            .slice(0, CONFIG.maxTargets);

        // Check active scripts BEFORE we schedule, so we don't over-schedule
        let activeStats = getNetworkStatus(ramServers);

        for (let target of targets) {
            // If we are already attacking this target, skip scheduling new threads for a moment
            if (activeStats[target]) continue; 

            let moneyMax = ns.getServerMaxMoney(target);
            let moneyCur = ns.getServerMoneyAvailable(target);
            let secMin = ns.getServerMinSecurityLevel(target);
            let secCur = ns.getServerSecurityLevel(target);
            
            let script = "", threads = 0;

            if (secCur > secMin + CONFIG.minSecurityThresh) {
                script = SCRIPTS.weak;
                threads = Math.ceil((secCur - secMin) / 0.05);
            } else if (moneyCur < moneyMax * CONFIG.minMoneyThresh) {
                script = SCRIPTS.grow;
                threads = Math.ceil(ns.growthAnalyze(target, moneyMax / Math.max(moneyCur, 1)));
            } else {
                script = SCRIPTS.hack;
                threads = Math.ceil(CONFIG.stealPercent / ns.hackAnalyze(target));
                threads = Math.min(threads, Math.ceil(0.90 / ns.hackAnalyze(target)));
            }

            if (threads > 0) {
                await distributeRun(script, threads, target, ramServers);
            }
        }

        // 2. XP DUMP
        let totalMax = ramServers.reduce((sum, s) => sum + ns.getServerMaxRam(s), 0);
        let totalUsed = ramServers.reduce((sum, s) => sum + ns.getServerUsedRam(s), 0);
        let realUsed = totalUsed + Math.min(CONFIG.reserveHomeRam, ns.getServerMaxRam("home") - ns.getServerUsedRam("home"));
        let freeRam = totalMax - realUsed;

        if (freeRam > 50) { 
            let growCost = ns.getScriptRam(SCRIPTS.grow);
            let xpThreads = Math.floor(freeRam / growCost);
            if (xpThreads > 0) {
                await distributeRun(SCRIPTS.grow, xpThreads, CONFIG.xpTarget, ramServers);
            }
        }

        // 3. RENDER UI (Scan again to capture what we just launched)
        let finalStats = getNetworkStatus(ramServers);
        let finalUsed = ramServers.reduce((sum, s) => sum + ns.getServerUsedRam(s), 0);
        printDashboard(finalStats, totalMax, finalUsed);
        
        await ns.sleep(CONFIG.refreshRate);
    }
}
