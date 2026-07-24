import Groq from 'groq-sdk';
const g = new Groq({ apiKey: 'test' });
console.log('ok', typeof g.chat);