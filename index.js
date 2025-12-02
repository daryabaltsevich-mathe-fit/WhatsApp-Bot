// index.js
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// === CONFIG ===
const VERIFY_TOKEN = "mytoken";            // Тот же, что в Meta Webhook
const API_VERSION = "v22.0";
const PHONE_NUMBER_ID = "861067863758910";   // из Meta WhatsApp
const WHATSAPP_TOKEN = "EAAK4bmxPgPgBQMPDTq4ZBLRYDQSBOunPaX3ZBiGMJYleRBlW9VBg3VtCDUtWru6i9ozdp8qCmQbuc7gl1c42zNFRdVXBXveOCuBhZALbZBqP8q7uDiUoE0ZACLhqXNqkbWII56SCVe2r9OAbdXE9cwFs0k0FVRF0ChLn6ZB4uNPlxlY45lZASkXuqCt2DNn3ReDC6fHmvFsgN2AwM3rwSEIo8QYnZBVwhP7fVuX1oThyFhNZAZA8jGO7kdSFZANe2ciMxyuQ0xeTSZCZBnCumoH1ymLxX9ZCCcZAX8ZD"; // из Meta WhatsApp

const TRELLO_KEY = "fec045404a8b769939f1ade47752f9f8";       // из Power-Up
const TRELLO_TOKEN = "ATTA00c1ab21765c2e281478a6425904e076d44619418f24a102e0e5fd62aad0d84305515084";   // из Power-Up
const TRELLO_LIST_ID = "691ef95c61ad757be0df8dda";      // ID списка в Trello

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

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
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
                key: TRELLO_KEY,
                token: TRELLO_TOKEN,
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


        // await handleListSelection(from, choice, state, res)
        // return 

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
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body }
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
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
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
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
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

// === Send final confirm/cancel buttons ===
async function sendFinalConfirmButtons(to) {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
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
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}


// === HANDLE LIST SELECTION ===
// async function handleListSelection(from, choice, state, res) {
//   const listId = TRELLO_LISTS[choice];
//   console.log(choice, listId, state)

//   if (!listId) {
//     await sendText(from, "Неизвестный список!");
//     return res.sendStatus(200);
//   }

//   // Создаём карточку
//   await axios.post(
//     `https://api.trello.com/1/cards`,
//     null,
//     {
//       params: {
//         key: TRELLO_KEY,
//         token: TRELLO_TOKEN,
//         idList: listId,
//         name: state.title,
//         desc: state.forwarded
//       }
//     }
//   );

//   await sendText(from, `Карточка создана в списке ${choice}`);

//   // Очистить состояние
//   chatState[from] = null;

//   res.sendStatus(200);
// }


// === Start server ===
app.listen(3000, () => console.log("Server running on port 3000"));