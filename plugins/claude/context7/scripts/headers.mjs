const apiKey = process.env.CONTEXT7_API_KEY;

process.stdout.write(JSON.stringify(apiKey ? { Authorization: apiKey } : {}));
