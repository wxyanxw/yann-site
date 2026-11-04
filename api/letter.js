import { handleLetter } from '../server/letter-service.js';

export const config = { api:{ bodyParser:false } };
export default handleLetter;
