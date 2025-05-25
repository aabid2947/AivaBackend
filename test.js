// generate_env_string.js (or test.js)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // <--- Import this!

// Reconstruct __filename and __dirname for ES Module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountFilePath = path.resolve(__dirname, 'serviceAccountKey.json');

try {
    const rawJsonContent = fs.readFileSync(serviceAccountFilePath, 'utf-8');
    const parsedJson = JSON.parse(rawJsonContent);

    const escapedJsonString = JSON.stringify(parsedJson);

    console.log('Copy this entire line into your .env file as FIREBASE_SERVICE_ACCOUNT_JSON:');
    console.log(`FIREBASE_SERVICE_ACCOUNT_JSON=${escapedJsonString}`);

} catch (error) {
    console.error('Error generating environment variable string:', error);
    console.error('Please ensure serviceAccountKey.json exists and is valid JSON.');
}