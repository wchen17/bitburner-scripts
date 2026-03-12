/** 
 * git-pull.js (The Updater)
 * 
 * This script serves to synchronize your local Bitburner files with a remote GitHub repository.
 * It dynamically fetches the list of files in the repository using the GitHub REST API and
 * downloads them locally, ensuring that you always have the latest code.
 * 
 * Pedagogical Note: This script uses modern JavaScript features like `async/await`, `fetch`, 
 * Arrow Functions, and the `try/catch` error handling block. 
 * 
 * @param {NS} ns - The Netscript 2.0 environment object, giving us access to Bitburner's functions.
 */
export async function main(ns) {
    // Clear the terminal logs for a clean output when running the script
    ns.clearLog();
    // Disable default logging for `sleep` and `wget` to reduce console spam during mass downloads
    ns.disableLog('sleep');
    ns.disableLog('wget');

    // --- Configuration ---
    // Change these if you ever fork the repository or use a different branch.
    // The target is hardcoded according to the requirements.
    const githubUser = 'wchen17';
    const repository = 'bitburner-scripts';
    const branch = 'main';

    // The base URL used to construct the raw file download link.
    // 'raw.githubusercontent.com' serves the raw text content of the files without the GitHub webpage UI.
    const rawBaseUrl = `https://raw.githubusercontent.com/${githubUser}/${repository}/${branch}/`;

    // The GitHub REST API endpoint to get a recursive tree of all files in the branch.
    // 'recursive=1' forces GitHub to return the full directory structure in a single flat array.
    // This is vastly superior to making separate API calls for every folder, thus saving our Rate Limit.
    const apiUrl = `https://api.github.com/repos/${githubUser}/${repository}/git/trees/${branch}?recursive=1`;

    // Define the file extensions we are interested in downloading. 
    // We filter out anything else (e.g. markdown (.md), images, json configs) to save time and space.
    const validExtensions = ['.js', '.ns', '.txt'];

    // --- Dynamic File Fetching via API ---
    // We use a `try...catch` block here to gracefully handle potential API failures.
    // The most common failure is hitting the GitHub API Rate Limit (60 requests per hour for unauthenticated IPs).
    // `try` means "attempt to run this code block". If an error occurs inside `try` (like a network failure),
    // execution jumps immediately to the `catch` block instead of crashing the script.
    let filesToDownload = [];
    try {
        ns.print(`[INFO] Fetching repository structure from: ${apiUrl}`);

        // `fetch` is a standard JavaScript function to make HTTP requests over the internet.
        // It returns a "Promise", so we must `await` it to pause execution until the request finishes.
        const response = await fetch(apiUrl);

        // If the request failed (e.g., status 403 Rate Limit Exceeded or 404 Not Found),
        // we throw an Error manually to force a jump to the `catch` block below.
        if (!response.ok) {
            throw new Error(`GitHub API responded with status: ${response.status} ${response.statusText}`);
        }

        // We `await response.json()` to parse the HTTP response from JSON text into a usable JavaScript object.
        const data = await response.json();

        // The API returns an object with a "tree" array containing all items (files, folders) in the repo.
        // We chain an array `.filter()` and `.map()` to process this data:
        filesToDownload = data.tree
            // 1. Keep only files ("blob" is Git terminology for an actual file containing data, as opposed to a "tree"/folder)
            .filter(item => item.type === "blob")
            // 2. Keep only files whose path ends with one of our approved extensions
            .filter(item => validExtensions.some(ext => item.path.endsWith(ext)))
            // 3. Extract just the file path string (e.g., "helpers.js", "Tasks/backdoor.js")
            .map(item => item.path);

        ns.print(`[SUCCESS] Found ${filesToDownload.length} valid files to download.`);
    } catch (error) {
        // If anything failed inside the `try` block, execution drops down to here.
        ns.tprint(`[ERROR] Failed to fetch repository listing: ${error.message}`);
        ns.tprint(`[INFO] This is usually caused by hitting the GitHub API limit (60 requests/hour).`);
        ns.tprint(`       Please try again in a little while.`);
        // We return early to strictly stop the script, as we don't have a list of files to iterate over.
        return;
    }

    // --- Download & Overwrite Logic ---
    // Now that we have our list of valid files, we iterate over them.
    // A `for...of` loop is the safest way to iterate an array when dealing with `await`ed asynchronous operations.
    let successCount = 0;
    for (const filePath of filesToDownload) {
        // Construct the full URL to the raw file on GitHub
        const remoteFilePath = rawBaseUrl + filePath;

        // **Cache-Busting Mechanism**
        // Browsers and internal game caches will often save previously downloaded files to save bandwidth.
        // To force them to bypass the cache and fetch the latest version, we append a query parameter: `?ts=`
        // By assigning `Date.now()` (the exact current time in milliseconds), the URL is always 100% unique.
        const cacheBusterUrl = `${remoteFilePath}?ts=${Date.now()}`;

        // `ns.wget` is a reliable Bitburner command that downloads from a URL and saves it to the local game drive.
        // It returns a Promise<boolean> indicating whether the download naturally succeeded.
        const success = await ns.wget(cacheBusterUrl, filePath);

        if (success) {
            ns.print(`[+] Overwritten/Created: ${filePath}`);
            successCount++;
        } else {
            ns.print(`[!] Failed to download: ${filePath}`);
            ns.tprint(`[ERROR] Failed to download/update: ${filePath}`);
        }

        // We pause for a microsecond (10ms) to yield the thread back to the game. 
        // This prevents freezing the game UI if the file list is exceptionally large. 
        await ns.sleep(10);
    }

    // Final user notification
    ns.tprint(`[SUCCESS] git-pull.js update complete! Installed/Updated ${successCount} out of ${filesToDownload.length} files.`);
}
