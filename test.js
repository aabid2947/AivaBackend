// test.js (or convertToJsonEnv.js if that's the file you're running)

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs'; // Use ES module import for fs
import path from 'path'; // Use ES module import for path

// Get the current file's path using import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---
// IMPORTANT: Update this path to your downloaded Firebase Service Account JSON file
// You can use path.join for better cross-platform compatibility
const inputFilePath = path.join(__dirname, 'serviceAccountKey.json'); // Assumes serviceAccountKey.json is in the same directory as this script

// OR, if the file is at an absolute path like C:\Users\hp\Downloads\serviceAccountKey.json
// const inputFilePath = 'C:\\Users\\hp\\Downloads\\serviceAccountKey.json'; // Use double backslashes for absolute Windows paths

// --- Main Logic ---
try {
    const jsonContent = fs.readFileSync(inputFilePath, 'utf8');
    const serviceAccount = JSON.parse(jsonContent);
    const oneLineJsonString = JSON.stringify(serviceAccount);
    console.log(`FIREBASE_SERVICE_ACCOUNT_JSON="${oneLineJsonString}"`);

} catch (error) {
    if (error.code === 'ENOENT') {
        console.error(`ERROR: Input file not found at '${inputFilePath}'.`);
        console.error("Please update 'inputFilePath' in the script to your downloaded Firebase Service Account JSON file.");
    } else if (error instanceof SyntaxError) {
        console.error(`ERROR: Failed to parse JSON from '${inputFilePath}'.`);
        console.error("Please ensure the input file contains valid JSON.");
        console.error("Parsing error details:", error.message);
    } else {
        console.error("An unexpected error occurred:", error.message);
    }
    process.exit(1);
}