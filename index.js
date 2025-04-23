const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const AZURE_ORG = process.env.AZURE_ORG;
const AZURE_PAT = process.env.AZURE_PAT;

const ALLOWED_USER_ID = 1618844598;

// Telegram bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Azure DevOps auth header
const authHeader = {
    headers: {
        'Authorization': 'Basic ' + Buffer.from(':' + AZURE_PAT).toString('base64')
    }
};

// Handle /start
bot.onText(/\/start/, (msg) => {
    if (msg.from.id !== ALLOWED_USER_ID) {
        bot.sendMessage(msg.chat.id, "🚫 You are not allowed to use this bot.");
        return;
    }
    bot.sendMessage(msg.chat.id, 'Hello! I will notify you about Azure DevOps approvals and deployments!');
});

// Handle Approve/Reject/Redeploy buttons
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const fromId = callbackQuery.from.id;

    if (fromId !== ALLOWED_USER_ID) {
        bot.answerCallbackQuery(callbackQuery.id, { text: "🚫 You are not allowed to use this bot.", show_alert: true });
        return;
    }

    const [action, id1, id2, encodedProjectName] = callbackQuery.data.split(':');
    const projectName = decodeURIComponent(encodedProjectName);

    try {
        if (action === 'approve') {
            await approveAzureApproval(id1, projectName);
            bot.sendMessage(msg.chat.id, `✅ Successfully approved ID ${id1} in Azure DevOps!`);
        } else if (action === 'reject') {
            await rejectAzureApproval(id1, projectName);
            bot.sendMessage(msg.chat.id, `❌ Successfully rejected ID ${id1} in Azure DevOps!`);
        } else if (action === 'redeploy') {
            await redeployRelease(projectName, id1, id2);
            bot.sendMessage(msg.chat.id, `🔁 Redeployment started for release ${id1} in ${projectName}`);
        }
    } catch (error) {
        console.error('Action failed:', error.response?.data || error.message);
        bot.sendMessage(msg.chat.id, `⚠️ Action failed: ${error.message}`);
    }
});

// Send approval notification
function sendApprovalMessage(chatId, projectName, releaseName, environmentName, approvalId) {
    const text = `🛠 *Approval Pending*\n\n*Project:* ${projectName}\n*Release:* ${releaseName}\n*Environment:* ${environmentName}`;
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Approve', callback_data: `approve:${approvalId}::${encodeURIComponent(projectName)}` },
                    { text: '❌ Reject', callback_data: `reject:${approvalId}::${encodeURIComponent(projectName)}` }
                ]
            ]
        }
    };
    bot.sendMessage(chatId, text, opts);
}

// Send success notification
function sendSuccessMessage(chatId, projectName, releaseName, environmentName) {
    const text = `✅ *Deployment Succeeded!*\n\n*Project:* ${projectName}\n*Release:* ${releaseName}\n*Environment:* ${environmentName}`;
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

// Send failed deployment with redeploy button
function sendRedeployMessage(chatId, projectName, releaseId, releaseName, environmentId, environmentName) {
    const text = `❌ *Deployment Failed*\n\n*Project:* ${projectName}\n*Release:* ${releaseName}\n*Environment:* ${environmentName}`;
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔁 Redeploy', callback_data: `redeploy:${releaseId}:${environmentId}:${encodeURIComponent(projectName)}` }
                ]
            ]
        }
    };
    bot.sendMessage(chatId, text, opts);
}

// Azure DevOps webhook handler
app.post('/azuredevops-webhook', (req, res) => {
    const body = req.body;
    const eventType = body.eventType;

    if (eventType === 'ms.vss-release.deployment-approval-pending-event') {
        const approvalId = body.resource.approval.id;
        const projectName = body.resource.project.name;
        const releaseName = body.resource.release.name;
        const environmentName = body.resource.approval.releaseEnvironment.name;

        sendApprovalMessage(CHAT_ID, projectName, releaseName, environmentName, approvalId);
    }

    if (eventType === 'ms.vss-release.deployment-completed-event') {
        const status = body.resource.deployment.deploymentStatus;
        const projectName = body.resource.project.name;
        const releaseId = body.resource.environment.releaseId;
        const releaseName = body.resource.deployment.release.name;
        const environmentId = body.resource.environment.id;
        const environmentName = body.resource.environment.name;

        if (status === 'failed') {
            sendRedeployMessage(CHAT_ID, projectName, releaseId, releaseName, environmentId, environmentName);
        } else if (status === 'succeeded') {
            sendSuccessMessage(CHAT_ID, projectName, releaseName, environmentName);
        }
    }

    res.status(200).send('OK');
});

// Approve
async function approveAzureApproval(approvalId, projectName) {
    const url = `https://vsrm.dev.azure.com/${AZURE_ORG}/${projectName}/_apis/release/approvals/${approvalId}?api-version=7.1`;
    await axios.patch(url, {
        status: "approved",
        comments: "Approved by Movses Martirosyan"
    }, authHeader);
}

// Reject
async function rejectAzureApproval(approvalId, projectName) {
    const url = `https://vsrm.dev.azure.com/${AZURE_ORG}/${projectName}/_apis/release/approvals/${approvalId}?api-version=7.1`;
    await axios.patch(url, {
        status: "rejected",
        comments: "Rejected by Movses Martirosyan"
    }, authHeader);
}

// Redeploy
async function redeployRelease(projectName, releaseId, environmentId) {
    const url = `https://vsrm.dev.azure.com/${AZURE_ORG}/${projectName}/_apis/release/releases/${releaseId}/environments/${environmentId}?api-version=7.1-preview.4`;
    await axios.post(url, {}, authHeader);
}

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Webhook server listening on port ${PORT}`);
});
