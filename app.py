import streamlit as st
import snowflake.connector
import json
from dotenv import load_dotenv
import os
import pandas as pd

# ---------------------------
# Load environment variables
# ---------------------------
load_dotenv()

SNOW_USER = os.getenv("SNOWFLAKE_USER")
SNOW_PASS = os.getenv("SNOWFLAKE_PASSWORD")
SNOW_ACCOUNT = os.getenv("SNOWFLAKE_ACCOUNT")
SNOW_WH = os.getenv("SNOWFLAKE_WAREHOUSE")
SNOW_DB = os.getenv("SNOWFLAKE_DATABASE")
SNOW_SCHEMA = os.getenv("SNOWFLAKE_SCHEMA")

# ---------------------------
# Create Snowflake connection
# ---------------------------
def get_snowflake_connection():
    return snowflake.connector.connect(
        user=SNOW_USER,
        password=SNOW_PASS,
        account=SNOW_ACCOUNT,
        warehouse=SNOW_WH,
        database=SNOW_DB,
        schema=SNOW_SCHEMA
    )

# ---------------------------
# Streamlit UI
# ---------------------------
st.set_page_config(page_title="AI Incident Assistant", layout="wide")
st.title("🚀 LO Incident Intelligence Assistant")

incident_text = st.text_area(
    "Describe the new incident:",
    placeholder="e.g. API gateway timeout when payload delivery happened",
    height=150
)

# ---------------------------
# Main Button
# ---------------------------
if st.button("🔍 Get Recommended Resolution"):
    if not incident_text.strip():
        st.warning("Please enter an incident description.")
    else:

        with st.spinner("Analyzing incident and retrieving recommendations..."):

            try:
                conn = get_snowflake_connection()
                cur = conn.cursor()

                # Clean input for SQL safety
                clean_incident_text = incident_text.replace("'", "''")

                # ---------------------------------------------------------
                # STEP 1 — Compute embedding ONCE & retrieve similar cases
                # ---------------------------------------------------------
                similarity_query = """
                WITH INPUT_EMB AS (
                    SELECT SNOWFLAKE.CORTEX.EMBED_TEXT_768(
                        'snowflake-arctic-embed-m', %s
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
                """

                cur.execute(similarity_query, (incident_text,))
                row = cur.fetchone()
                match_array_str = row[0] if row and row[0] else "[]"

                try:
                    match_list = json.loads(match_array_str)
                except:
                    match_list = []

                # ---------------------------------------------------------
                # DISPLAY SIMILAR INCIDENTS
                # ---------------------------------------------------------
                st.subheader("🧩 Top Similar Incidents")

                if match_list:
                    df = pd.DataFrame(match_list)
                    df = df.rename(columns={
                        "incident_id": "Incident ID",
                        "short_desc": "Short Description",
                        "similarity": "Similarity",
                        "resolution": "Resolution"
                    })
                    st.dataframe(df, use_container_width=True)
                else:
                    st.info("No relevant historical incidents found (SIM < 0.60).")
                
                # If no matches, still pass empty list to LLM
                matches_for_prompt = match_array_str if match_list else "[]"

                # ---------------------------------------------------------
                # STEP 2 — LLM PROMPT
                # ---------------------------------------------------------
                llm_prompt = f"""
You are an expert LO incident analyst.

A new incident occurred:
{incident_text}

Here are the similar historical incidents in JSON:
{matches_for_prompt}

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
"""

                llm_query = """
                    SELECT SNOWFLAKE.CORTEX.COMPLETE(
                        'snowflake-arctic',
                        %s
                    ) AS AI_SOLUTION;
                """

                cur.execute(llm_query, (llm_prompt,))
                ai_solution = cur.fetchone()[0]

                # ---------------------------------------------------------
                # DISPLAY FINAL AI RESPONSE
                # ---------------------------------------------------------
                st.subheader("🤖 AI-Generated Recommended Resolution")
                st.markdown(ai_solution.replace("\n", "  \n"))

            except Exception as e:
                st.error(f"Error while querying Snowflake: {e}")

            finally:
                try:
                    conn.close()
                except:
                    pass
