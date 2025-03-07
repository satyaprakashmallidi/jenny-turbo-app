import { Hono } from 'hono';
import { 
    getAllSingleAccounts, 
    createSingleAccount, 
    updateSingleAccount, 
    deleteSingleAccount, 
    getSingleAccount 
} from '../controller/single-twilio-account.controller';

const router = new Hono();

// Routes for single Twilio account operations (one account = one phone number)
router.get('/accounts', getAllSingleAccounts);
router.post('/account', createSingleAccount);
router.get('/account/:id', getSingleAccount);
router.patch('/account/:id', updateSingleAccount);
router.delete('/account/:id', deleteSingleAccount);

export default router; 