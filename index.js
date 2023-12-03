// Importing required modules and libraries
const express = require("express");
const app = express();
const fs = require("fs").promises;
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

// Scopes needed for necessary Gmail operations
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://mail.google.com/",
];

// Handling the root route
app.get("/", async (req, res) => {
  // Authorizing the client with credentials
  const auth = await authenticate({
    keyfilePath: path.join(__dirname, "./credentials.json"),
    scopes: SCOPES,
  });

  console.log("Authentication Successful");

  const labelName = "During Vacation"; // Label name for identifying vacation-related emails

  // Loading credentials from file
  async function loadCredentials() {
    const filePath = path.join(process.cwd(), "credentials.json");
    const content = await fs.readFile(filePath, { encoding: "utf-8" });
    return JSON.parse(content);
  }

  // Getting unreplied messages from Gmail
  async function gettingUnrepliedMsgs(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    try {
      const res = await gmail.users.messages.list({
        userId: "me",
        q: "-in:chats -from:me -has:userlabels",
      });
      return res.data.messages || [];
    } catch (err) {
      console.error("Error getting unreplied messages:", err);
    }
  }

  // Sending a reply to a given message
  async function sendReply(auth, message) {
    const gmail = google.gmail({ version: "v1", auth });
    try {
      // Getting message details for constructing the reply
      const res = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "metadata",
        metadataHeaders: ["Subject", "From"],
      });

      // Extracting subject and sender information
      const subject = res.data.payload.headers.find(
        (header) => header.name === "Subject"
      ).value;
      const from = res.data.payload.headers.find(
        (header) => header.name === "From"
      ).value;

      // Extracting the email address from sender information
      const replyTo = from.match(/<(.*)>/)[1];

      // Creating reply subject and body
      const replySubject = subject.startsWith("Reply:")
        ? subject
        : `Reply: ${subject}`;
      const replyBody = `Hi,\n\nThanks for reaching out.\n\nCurrently I'm on vacation and will reply to you the day after tomorrow.`;

      // Constructing raw message
      const rawMessage = [
        `From: me`,
        `To: ${replyTo}`,
        `Subject: ${replySubject}`,
        `In-Reply-To: ${message.id}`,
        `References: ${message.id}`,
        "",
        replyBody,
      ].join("\n");

      // Sending the reply
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
    } catch (err) {
      console.error("Error sending reply:", err);
    }
  }

  // Creating a label for vacation-related emails
  async function createLabel(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    try {
      // Fetching existing labels
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
      console.error("Error creating label and moving email:", err);
    }
  }

  // Adding the vacation label to a message
  async function addLabel(auth, message, labelId) {
    const gmail = google.gmail({ version: "v1", auth });
    try {
      // Modifying the labels of the message
      await gmail.users.messages.modify({
        userId: "me",
        id: message.id,
        requestBody: {
          addLabelIds: [labelId],
          removeLabelIds: ["INBOX"],
        },
      });
    } catch (err) {
      console.error("Error adding label to meassage:", err);
    }
  }

  // App Functions Starts
  loadCredentials();

  // Creating a label for vacation-related emails
  const labelId = await createLabel(auth);
  console.log(`Label Created with id ${labelId}`);

  // Function to periodically check for unreplied messages and respond
  async function checkEmails() {
    // Getting all messages with no replies
    const messages = await gettingUnrepliedMsgs(auth);
    console.log(`${messages.length} Unreplied Messages Found`);

    // Processing each unreplied message
    for (let msg of messages) {
      // Sending a reply
      await sendReply(auth, msg);
      console.log(`Reply sent to message with id ${msg.id}`);

      // Adding the vacation label to the message
      await addLabel(auth, msg, labelId);
      console.log(`Label added to message with id ${msg.id}`);
    }
  }

  // Setting up periodic email checking with a random interval between 45 to 120 seconds
  setInterval(
    checkEmails,
    Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000
  );

  // Sending a success response to the client
  res.send("Successfully logged in to the Automated Gmail Responser");
});

// Starting the server on port 5000
app.listen(5000, () => {
  console.log("App is Running");
});
