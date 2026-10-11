const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ai = require('./lib/ai');
const mediaRoot = path.join(__dirname, 'work', 'videos');

module.exports = ({ complete, withCredit, wrap }) => {
    const router = express.Router();
    router.get('/', (req, res) => res.render('youtube'));
    router.post('/process', wrap(async (req, res) => {
        const url = req.body.youtube_url;
        if (typeof url !== 'string' || !ytdl.validateURL(url)) return res.status(400).render('error', { message: 'Enter a valid YouTube video URL.' });
        const language = ai.normalizeLanguage(req.body.language);
        const dir = path.join(mediaRoot, crypto.randomUUID());
        await fs.mkdir(dir, { recursive: true });
        try {
            const description = await withCredit(req.session.userId, async () => {
                const info = await ytdl.getInfo(url);
                if (info.videoDetails.isLiveContent || Number(info.videoDetails.lengthSeconds) > 180 || !Number(info.videoDetails.lengthSeconds)) {
                    const error = new Error('Use a non-live video up to three minutes long.'); error.status = 400; throw error;
                }
                const videoPath = path.join(dir, 'video.mp4');
                const stream = ytdl.downloadFromInfo(info, { quality: 'highest', filter: 'audioandvideo' });
                let bytes = 0;
                stream.on('data', chunk => { bytes += chunk.length; if (bytes > 50 * 1024 * 1024) stream.destroy(new Error('Video exceeds 50 MB.')); });
                const timer = setTimeout(() => stream.destroy(new Error('Video download timed out.')), 60000);
                try { await pipeline(stream, require('node:fs').createWriteStream(videoPath)); }
                finally { clearTimeout(timer); }
                await new Promise((resolve, reject) => {
                    ffmpeg(videoPath, { timeout: 60 }).output(path.join(dir, 'frame-%03d.jpg'))
                        .outputOptions(['-vf fps=1/20,scale=640:-1', '-frames:v 8'])
                        .on('end', resolve).on('error', reject).run();
                });
                const frames = (await fs.readdir(dir)).filter(name => /^frame-\d+\.jpg$/.test(name)).sort();
                if (!frames.length) throw new Error('No frames could be extracted.');
                const images = await Promise.all(frames.map(async name => `data:image/jpeg;base64,${(await fs.readFile(path.join(dir, name))).toString('base64')}`));
                return complete(ai.descriptionMessages(images, language));
            });
            res.render('product', { imageUrls: [], description, language });
        } finally { await fs.rm(dir, { recursive: true, force: true }); }
    }));
    return router;
};
