const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const YOUR_CHAT_ID = process.env.YOUR_CHAT_ID;
const AZURE_ORG = process.env.AZURE_ORG;
const AZURE_PAT = process.env.AZURE_PAT;

// Telegram bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Authorization header for Azure DevOps API
const authHeader = {
    headers: {
        'Authorization': 'Basic ' + Buffer.from(':' + AZURE_PAT).toString('base64')
    }
};

// Start message
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Hello! I will notify you about Azure DevOps approvals!');
});

// Send approval message with buttons
function sendApprovalMessage(chatId, projectName, releaseName, environmentName, approvalId) {
    const messageText = `🛠 *Approval Pending*\n\n` +
        `*Project:* ${projectName}\n` +
        `*Release:* ${releaseName}\n` +
        `*Environment:* ${environmentName}`;

    const opts = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Approve', callback_data: `approve:${approvalId}` },
                    { text: '❌ Reject', callback_data: `reject:${approvalId}` }
                ]
            ]
        }
    };
    bot.sendMessage(chatId, messageText, { parse_mode: 'Markdown', ...opts });
}

// Handle Approve/Reject button clicks
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const [action, approvalId] = callbackQuery.data.split(':');

    try {
        if (action === 'approve') {
            await approveAzureApproval(approvalId);
            bot.sendMessage(msg.chat.id, `✅ Successfully approved ID ${approvalId} in Azure DevOps!`);
        } else if (action === 'reject') {
            await rejectAzureApproval(approvalId);
            bot.sendMessage(msg.chat.id, `❌ Successfully rejected ID ${approvalId} in Azure DevOps!`);
        }
    } catch (error) {
        console.error('Approval/Rejection failed:', error.response?.data || error.message);
        bot.sendMessage(msg.chat.id, `⚠️ Failed to approve/reject: ${error.message}`);
    }
});

// Azure DevOps webhook listener
app.post('/azuredevops-webhook', (req, res) => {
    const body = req.body;
    console.log('Received Azure DevOps webhook:', JSON.stringify(body, null, 2));

    if (body.eventType === 'ms.vss-release.deployment-approval-pending-event') {
        const approvalId = body.resource.id;
        const projectName = body.resource.project.name;
        const releaseName = body.resource.release.name;
        const environmentName = body.resource.environment.name;

        sendApprovalMessage(YOUR_CHAT_ID, projectName, releaseName, environmentName, approvalId);
    }

    res.status(200).send('OK');
});

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
});

// Approve Approval
async function approveAzureApproval(approvalId) {
    const url = `https://vsrm.dev.azure.com/${AZURE_ORG}/_apis/release/approvals/${approvalId}?api-version=7.1-preview.4`;

    await axios.patch(url, {
        status: "approved",
        comments: "Approved by Movses Martirosyan"
    }, authHeader);
}

// Reject Approval
async function rejectAzureApproval(approvalId) {
    const url = `https://vsrm.dev.azure.com/${AZURE_ORG}/_apis/release/approvals/${approvalId}?api-version=7.1-preview.4`;

    await axios.patch(url, {
        status: "rejected",
        comments: "Rejected via Movses Martirosyan"
    }, authHeader);
}
