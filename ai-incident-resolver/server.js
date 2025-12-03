const express = require('express');
const snowflake = require('snowflake-sdk');
const dotenv = require('dotenv');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// Load environment variables from the parent directory's .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Snowflake Connection Configuration
const connection = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USER,
    password: process.env.SNOWFLAKE_PASSWORD,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA
});

// Connect to Snowflake
connection.connect((err, conn) => {
    if (err) {
        console.error('Unable to connect to Snowflake: ' + err.message);
    } else {
        console.log('Successfully connected to Snowflake.');
    }
});

// Helper to execute queries
const executeQuery = (query, binds = []) => {
    return new Promise((resolve, reject) => {
        connection.execute({
            sqlText: query,
            binds: binds,
            complete: (err, stmt, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        });
    });
};

// API Endpoint: Resolve Incident
app.post('/api/resolve', async (req, res) => {
    const { incidentText } = req.body;

    if (!incidentText) {
        return res.status(400).json({ error: 'Incident description is required.' });
    }

    try {
        // STEP 1: Compute embedding and retrieve similar cases
        const similarityQuery = `
            WITH INPUT_EMB AS (
                SELECT SNOWFLAKE.CORTEX.EMBED_TEXT_768(
                    'snowflake-arctic-embed-m', ?
                ) AS EMB
            ),
            MATCHES AS (
                SELECT DISTINCT 
                    INCIDENT_ID,
                    SHORT_DESC,
                    RESOLUTION,
                    VECTOR_COSINE_SIMILARITY(FULL_TEXT_EMBED, (SELECT EMB FROM INPUT_EMB)) AS SIM
                FROM INCIDENT_VECTOR_STORE
                WHERE VECTOR_COSINE_SIMILARITY(FULL_TEXT_EMBED, (SELECT EMB FROM INPUT_EMB)) > 0.60
                ORDER BY SIM DESC
                LIMIT 5
            )
            SELECT ARRAY_AGG(
                OBJECT_CONSTRUCT(
                    'incident_id', INCIDENT_ID,
                    'short_desc', SHORT_DESC,
                    'resolution', RESOLUTION,
                    'similarity', SIM
                )
            )::STRING AS MATCH_ARRAY
            FROM MATCHES;
        `;

        const similarityRows = await executeQuery(similarityQuery, [incidentText]);
        const matchArrayStr = similarityRows[0]['MATCH_ARRAY'] || "[]";
        let matchList = [];
        try {
            matchList = JSON.parse(matchArrayStr);
        } catch (e) {
            console.error("Error parsing match list:", e);
        }

        const matchesForPrompt = matchList.length > 0 ? matchArrayStr : "[]";

        // STEP 2: Generate AI Resolution
        const llmPrompt = `
You are an expert LO incident analyst.

A new incident occurred:
${incidentText}

Here are the similar historical incidents in JSON:
${matchesForPrompt}

Using ONLY this information, return the output in this exact structure:

1. Similar Incident IDs:
   - Comma-separated list of incident_ids, or "None".

2. Unified Root Cause:
   - One concise root cause summarizing patterns found.

3. Recommended Resolution (4–7 Steps):
   - Numbered steps.
   - Combine only relevant actions from past incidents.
   - Avoid repetition.

4. Validation Steps (3–5 Steps):
   - Numbered steps.
   - Confirm the fix.

5. Action Summary:
   - 1–2 crisp sentences describing the final fix and prevention.

Do NOT repeat the incident description.
Do NOT repeat the JSON input.
Only output the structured answer.
`;

        const llmQuery = `
            SELECT SNOWFLAKE.CORTEX.COMPLETE(
                'snowflake-arctic',
                ?
            ) AS AI_SOLUTION;
        `;

        const llmRows = await executeQuery(llmQuery, [llmPrompt]);
        const aiSolution = llmRows[0]['AI_SOLUTION'];

        res.json({
            similarIncidents: matchList,
            aiRecommendation: aiSolution
        });

    } catch (error) {
        console.error('Error processing incident:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve static files from React app (after build)
app.use(express.static(path.join(__dirname, 'client/dist')));

app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
