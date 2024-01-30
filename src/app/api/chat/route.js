import OpenAI from "openai";
import { OpenAIStream, StreamingTextResponse } from "ai";

export const runtime = "edge";

const systemMessage = (
  lang
) => `You are a helpful assistant.
${lang ? `Assistant must speak in this language : "${lang}".` : ""}`;

export async function POST(req) {
  const json = await req.json();
  const { messages, lang } = json;

  let token = json.token;

  if (token === "null") {
    token = null;
  }

  if (!token && !process.env.OPENAI_API_KEY) {
    return Response.json({
      error: "No API key provided.",
    });
  }

  const openai = new OpenAI({
    apiKey: token || process.env.OPENAI_API_KEY,
  });

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo-1106",
    stream: true,
    temperature: 0.5,
    messages: [{ role: "system", content: systemMessage(lang) }].concat(
      messages
    ),
    max_tokens: 2000,
  });

  const stream = OpenAIStream(response);
  return new StreamingTextResponse(stream);
}
