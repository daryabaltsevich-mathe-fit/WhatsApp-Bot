import dotenv from 'dotenv';
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());



const TRELLO_LISTS = {
    "Kundenplannung": "691ef95c61ad757be0df8dda",
    "IT Automatisierung": "691ef9f9b20f6b8343d06b74",
    "Verträge": "691ece9fa66d74f3aafc59e5"
}

const chatState = {} // { [from]: { stage, forwarded, title, listId } }

// === Webhook Verification ===
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// === Receive WhatsApp Messages ===
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];


    if(!msg) return res.sendStatus(200);

    const from = msg.from;
    const type = msg.type;

    if (!chatState[from]) {
      chatState[from] = { stage: null, forwarded: null, title: null, listId: null };
    }
    const state = chatState[from];

    // Если пользователь нажал кнопку
    if(type === "interactive" && msg.interactive?.button_reply) {
        const choice = msg.interactive.button_reply.id;
        console.log("Button", choice, "Stage", state.stage)


         // Этап финального подтверждения
      if (state.stage === "confirm_send") {
        if (choice === "FINAL_CONFIRM") {
          // Создаём карточку
          await axios.post(
            `https://api.trello.com/1/cards`,
            null,
            {
              params: {
                key: process.env.TRELLO_KEY,
                token: process.env.TRELLO_TOKEN,
                idList: state.listId,
                name: state.title,
                desc: state.forwarded
              }
            }
          );
          await sendText(from, "Ticket wurde erstellt!");
          chatState[from] = null;
          return res.sendStatus(200);
        }
        if (choice === "FINAL_CANCEL") {
          await sendText(from, "Ticketserstellung wurde abgebrochen.");
          chatState[from] = null;
          return res.sendStatus(200);
        }
      }

      // Этап выбора списка
      if (state.stage === "ask_list") {
        if (!TRELLO_LISTS[choice]) {
          await sendText(from, "Unbekannte List!");
          return res.sendStatus(200);
        }
        state.listId = TRELLO_LISTS[choice];
        state.stage = "confirm_send";
        await sendFinalConfirmButtons(from);
        return res.sendStatus(200);
      }

    }

    const text = msg?.text?.body || "";

    if (!text) return res.sendStatus(200);
    console.log("Received text:", text, "Stage:", state.stage);



    // 1. Начало — сообщение переслано
    if (!state.stage) {
      state.forwarded = text;
      state.stage = "ask_title";

      await sendText(from, "Geben Sie den Namen der Aufgabe ein:");
      return res.sendStatus(200);
    }

    // 2. Пользователь вводит название
    if (state.stage === "ask_title") {
      state.title = text;
      state.stage = "ask_list";

      await sendListButtons(from);
      return res.sendStatus(200);
    }


    res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err.message);
    console.log(err.response.data)
    res.sendStatus(500);
  }
});


// === SEND TEXT ===
async function sendText(to, body) {
  await axios.post(
    `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body }
    },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
}

// === SEND BUTTONS ===
async function sendListButtons(to) {
    const buttons = Object.keys(TRELLO_LISTS).map(name => ({
        type: "reply",
        reply: {
            id:name,
            title: name
        }
    }))
  await axios.post(
    `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Wählen Sie ein Board aus:" },
        action: {
          buttons
        }}
    },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
}

// === Send final confirm/cancel buttons ===
async function sendFinalConfirmButtons(to) {
  await axios.post(
    `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Möchten Sie dieses Task in Trello erstellen?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "FINAL_CONFIRM", title: "Bestätigen" } },
            { type: "reply", reply: { id: "FINAL_CANCEL", title: "Abbrechen" } }
          ]
        }
      }
    },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
}

app.listen(3000, () => console.log("Server running on port 3000"));