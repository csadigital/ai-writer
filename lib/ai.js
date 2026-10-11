const axios = require('axios');
const languages = { en: 'English', tr: 'Turkish', es: 'Spanish', de: 'German', fr: 'French', zh: 'Chinese' };
function normalizeLanguage(value) { return Object.hasOwn(languages, value) ? value : 'en'; }
function descriptionMessages(imageUrls, language) {
    const target = languages[normalizeLanguage(language)];
    return [{ role: 'user', content: [
        { type: 'text', text: `Write an SEO-friendly product description in ${target} for the product in these images. Include a descriptive title, useful paragraphs and a list of visible features. Aim for 300 words when enough visual evidence exists. Do not invent fabric, dimensions, certifications, price or product codes. State when a detail cannot be confirmed. Return plain text only, without an introductory phrase.` },
        ...imageUrls.map(url => ({ type: 'image_url', image_url: { url, detail: 'auto' } }))
    ] }];
}
async function complete(messages) {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', messages, max_completion_tokens: 1800
    }, { timeout: 90000, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
    const text = response.data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('The AI service returned an empty response.');
    return text.trim();
}
module.exports = { languages, normalizeLanguage, descriptionMessages, complete };
