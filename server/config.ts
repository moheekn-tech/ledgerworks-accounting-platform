import 'dotenv/config';
import {readFileSync} from 'node:fs';
const fileKeys=['DATABASE_URL','OPENAI_API_KEY','ZOHO_ACCESS_TOKEN','ZOHO_REFRESH_TOKEN','ZOHO_CLIENT_ID','ZOHO_CLIENT_SECRET','TALLY_GATEWAY_TOKEN','FILING_API_TOKEN','BACKUP_KEY','SMTP_PASSWORD'];
for(const key of fileKeys)if(process.env[key+'_FILE'])process.env[key]=readFileSync(process.env[key+'_FILE']!,'utf8').trim();
