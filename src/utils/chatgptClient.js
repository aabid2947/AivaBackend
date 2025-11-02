// src/utils/chatgptClient.js
// Minimal OpenAI / ChatGPT client utility used by the Twilio streaming call service.
// - Respects OPENAI_API_KEY (or CHATGPT_API_KEY) from environment
// - Exposes generateChatgptText(prompt) -> Promise<string>
// - Exposes generateChatgptTextStream(prompt) -> async generator yielding text chunks

const DEFAULT_MODEL = process.env.CHATGPT_MODEL || 'gpt-4o-mini';

function getApiKey() {
    return process.env.OPENAI_API_KEY || process.env.CHATGPT_API_KEY;
}

async function generateChatgptText(prompt, opts = {}) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('OPENAI_API_KEY or CHATGPT_API_KEY is not set');

    const body = {
        model: opts.model || DEFAULT_MODEL,
        input: prompt,
        // users can override via opts
        ...(opts.requestOptions || {}),
    };

    const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI API error: ${res.status} ${text}`);
    }

    const data = await res.json();

    // Try a few places where text might live (Responses API vs legacy shapes)
    try {
        if (data.output && Array.isArray(data.output) && data.output.length > 0) {
            // modern Responses API
            const out = data.output.map(o => (o.content || []).map(c => c.text || '').join('')).join('\n');
            if (out) return out;
        }
    } catch (e) {
        // fallthrough
    }

    // Fallback: try choices (chat completions style)
    if (data.choices && data.choices[0]) {
        const choice = data.choices[0];
        if (choice.message && (choice.message.content || choice.message.text)) {
            return choice.message.content || choice.message.text || '';
        }
        if (choice.text) return choice.text;
    }

    return JSON.stringify(data);
}

// Streaming generator: yields partial text chunks as they arrive.
async function* generateChatgptTextStream(prompt, opts = {}) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('OPENAI_API_KEY or CHATGPT_API_KEY is not set');

    const body = {
        model: opts.model || DEFAULT_MODEL,
        input: prompt,
        stream: true,
        ...(opts.requestOptions || {})
    };

    const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI API error (stream): ${res.status} ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on event boundary - OpenAI streams data: lines separated by \n\n
        let parts = buffer.split(/\n\n/);
        // Keep last partial in buffer
        buffer = parts.pop();

        for (const part of parts) {
            // Split SSE events - format is "event: name\ndata: {...}"
            const lines = part.split('\n').filter(l => l.trim());
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                
                // Parse SSE data lines (ignore event: lines)
                if (trimmed.startsWith('data: ')) {
                    const dataStr = trimmed.substring(6).trim();
                    if (dataStr === '[DONE]') {
                        return;
                    }

                    try {
                        const parsed = JSON.parse(dataStr);
                        
                        // OpenAI Responses API: look for delta in output_text.delta
                        if (parsed.type === 'response.output_text.delta' && parsed.delta) {
                            yield parsed.delta;
                        }
                        // Responses API streaming chunk may include output_delta or choices
                        else if (parsed.output && Array.isArray(parsed.output)) {
                            const out = parsed.output.map(o => (o.content || []).map(c => c.text || '').join('')).join('');
                            if (out) yield out;
                        }
                        // Chat completions style
                        else if (parsed.choices && parsed.choices[0]) {
                            const choice = parsed.choices[0];
                            if (choice.delta && (choice.delta.content || choice.delta.text)) {
                                yield choice.delta.content || choice.delta.text || '';
                            } else if (choice.text) {
                                yield choice.text;
                            }
                        }
                    } catch (err) {
                        // Ignore non-JSON lines (like event: name)
                        console.warn(`[ChatGPT Stream] Failed to parse JSON: ${err.message}`);
                    }
                }
            }
        }
    }

    // Flush any remaining buffer if it contains JSON
    if (buffer && buffer.trim()) {
        const last = buffer.trim().replace(/^data: ?/, '');
        try {
            const parsed = JSON.parse(last);
            if (parsed.output && Array.isArray(parsed.output)) {
                const out = parsed.output.map(o => (o.content || []).map(c => c.text || '').join('')).join('');
                if (out) yield out;
            }
        } catch (e) {
            // ignore
        }
    }
}

export { generateChatgptText, generateChatgptTextStream, DEFAULT_MODEL };
