const express = require("express");
const app = express();

const fs = require("fs").promises;
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

// scopes needed for doing necessary functions with gmail
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://mail.google.com/",
];

app.get("/", async (req, res) => {
  // authorizing the client with credentials
  const auth = await authenticate({
    keyfilePath: path.join(__dirname, "./credentials.json"),
    scopes: SCOPES,
  });

  console.log("Authentication Successful");

  const gmail = google.gmail({ version: "v1", auth });

  const labelName = "During Vacation";

  // loading credentials
  async function loadCredentials() {
    const filePath = path.join(process.cwd(), "credentials.json");
    const content = await fs.readFile(filePath, { encoding: "utf-8" });
    return JSON.parse(content);
  }

  // getting msgs with no replies
  async function gettingUnrepliedMsgs(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.messages.list({
      userId: "me",
      q: "-in:chats -from:me -has:userlabels",
    });
    return res.data.messages || [];
  }

  // sending reply
  async function sendReply(auth, message) {
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From"],
    });

    const subject = res.data.payload.headers.find(
      (header) => header.name === "Subject"
    ).value;
    const from = res.data.payload.headers.find(
      (header) => header.name === "From"
    ).value;

    const replyTo = from.match(/<(.*)>/)[1];
    const replySubject = subject.startsWith("Reply:")
      ? subject
      : `Reply: ${subject}`;
    const replyBody = `Hi,\n\nThanks for reaching out.\n\nCurrently I'm on vacation and will reply to you the day after tomorrow.`;

    const rawMessage = [
      `From: me`,
      `To: ${replyTo}`,
      `Subject: ${replySubject}`,
      `In-Reply-To: ${message.id}`,
      `References: ${message.id}`,
      "",
      replyBody,
    ].join("\n");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: Buffer.from(rawMessage)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, ""),
      },
    });
  }

  // creating label
  async function createLabel(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    try {
      const labelsResponse = await gmail.users.labels.list({ userId: "me" });
      const label = labelsResponse.data.labels.find(
        (label) => label.name === labelName
      );

      if (label) {
        // If the label exists, retrieve its ID
        return label.id;
      } else {
        // If the label doesn't exist, create it
        const newLabel = await gmail.users.labels.create({
          userId: "me",
          requestBody: {
            name: labelName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
          },
        });
        return newLabel.data.id;
      }
    } catch (err) {
      console.error("Error adding label and moving email:", err);
    }
  }

  // adding label to msgs
  async function addLabel(auth, message, labelId) {
    const gmail = google.gmail({ version: "v1", auth });
    await gmail.users.messages.modify({
      userId: "me",
      id: message.id,
      requestBody: {
        addLabelIds: [labelId],
        removeLabelIds: ["INBOX"],
      },
    });
  }

  // App Functions Starts
  loadCredentials();
  // creating label
  const labelId = await createLabel(auth);
  console.log(`Label Created with id ${labelId}`);

  async function checkEmails() {
    // getting all msgs in an array with no replies
    const messages = await gettingUnrepliedMsgs(auth);
    console.log(`${messages.length} Unreplied Messages Found`);

    for (let msg of messages) {
      // sending reply
      await sendReply(auth, msg);
      console.log(`Reply sent to message with id ${msg.id}`);

      // adding label to message
      await addLabel(auth, msg, labelId);
      console.log(`Label added to message with id ${msg.id}`);
    }
  }

  setInterval(
    checkEmails,
    Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000
  );

  res.send("Successfully logged in to the Automated Gmail Responser");
});

app.listen(5000, () => {
  console.log("App is Running");
});
