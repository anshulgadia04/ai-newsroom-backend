import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import session from 'express-session';
import passport from './config/passport.js'; // Adjust the path if needed



const app = express();
app.use(session({
  secret: 'super-secret-key', // Change this in production
  resave: false,
  saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get('/', (req, res) => {
  res.send('Hello World!');
});



// Google OAuth
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('https://ai-newsroom-frontend-jqkpadmnx-anshulgadia04s-projects.vercel.app/dashboard');
  }
);

// GitHub OAuth
app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));

app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('https://ai-newsroom-frontend-jqkpadmnx-anshulgadia04s-projects.vercel.app/dashboard');
  }
);


// Logout
app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});



// Gemini API route
app.post('/generate-article', async (req, res) => {
  const { title, notes, category } = req.body;
  if (!title || !notes || !category) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const apiKey = 'AIzaSyCIuf9fnF2piaFjRvRiFy3b1CRlfqCBKDM'; 
  
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const prompt = `
You are an expert news writer. Given the inputs below, write a clean, professional news article with three sections:

1. Article (start this section with "## Article:")
2. Image Ideas (start this section with "## Image Ideas:")
3. Citations (start this section with "## Citations:")

Inputs:
- Title: ${title}
- Category: ${category}
- Notes: ${notes}

Ensure each section is clearly labeled and use proper formatting.
`;


  try {
    const response = await axios.post(
      `${endpoint}?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              { text: prompt }
            ]
          }
        ]
      }
    );
    const fullText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No article generated.';
    // Attempt to extract article, citations, and image ideas from the response
    let article = fullText;
    let citations = [];
    let imageIdeas = [];

    // Improved extraction using explicit section headers and bullet points
    const articleMatch = fullText.match(/## Article:\n([\s\S]*?)## Image Ideas:/i);
const imageMatch = fullText.match(/## Image Ideas:\n([\s\S]*?)## Citations:/i);
const citationMatch = fullText.match(/## Citations:\n([\s\S]*)/i);

// Clean values
if (articleMatch) article = articleMatch[1].trim();
if (imageMatch) {
  imageIdeas = imageMatch[1]
    .split('\n')
    .map(line => line.replace(/^[-*\d.]+\s*/, '').trim())
    .filter(Boolean);
}
if (citationMatch) {
  citations = citationMatch[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line.includes('http'));
}

    // If citations array is empty, extract URLs from article text
    if (citations.length === 0) {
      const urlRegex = /(https?:\/\/[^\s)]+)|(www\.[^\s)]+)/g;
      const foundUrls = article.match(urlRegex);
      if (foundUrls) {
        citations = foundUrls;
      }
    }

    // Remove all citation URLs from the article text
    if (citations.length > 0) {
      citations.forEach(url => {
        // Remove both plain and markdown-style links
        const urlPattern = new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        article = article.replace(urlPattern, '');
      });
      // Also remove leftover markdown link brackets
      article = article.replace(/\[([^\]]+)\]\s*\(\s*\)/g, '$1');
    }

    await prisma.article.create({
    data: {
        title,
        notes,
        category,
        content: article,
        citations,
        imageIdeas
    }
    });


    res.json({ article, citations, imageIdeas });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate article', details: error.message });
  }
});

// Fact checking route
app.post('/fact-check', async (req, res) => {
  const { article } = req.body;
  if (!article) {
    return res.status(400).json({ error: 'Missing article in request body' });
  }

  const apiKey = 'AIzaSyCIuf9fnF2piaFjRvRiFy3b1CRlfqCBKDM';
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  const prompt = `
You are a professional fact-checking assistant. Analyze the following article and return the result in this structured format:

## Fact Check Result
Status: Accurate / Inaccurate

## Issues Found
- List any inaccuracies or questionable claims with reasoning.
- If none, write "No factual issues found."

## Suggestions
- Recommend any corrections or improvements if needed.

## Final Verdict
Summarize the overall accuracy in 1-2 lines.

Article:
${article}
`;

  try {
    const response = await axios.post(
      `${endpoint}?key=${apiKey}`,
      {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      }
    );

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No result returned.';

    // Optional: Extract sections clearly
    const statusMatch = text.match(/Status:\s*(Accurate|Inaccurate)/i);
    const issuesMatch = text.match(/## Issues Found\n([\s\S]*?)## Suggestions/i);
    const suggestionsMatch = text.match(/## Suggestions\n([\s\S]*?)## Final Verdict/i);
    const verdictMatch = text.match(/## Final Verdict\n([\s\S]*)/i);

    const factCheck = {
      raw: text,
      status: statusMatch ? statusMatch[1] : 'Unknown',
      issues: issuesMatch ? issuesMatch[1].trim().split('\n').map(s => s.trim()).filter(Boolean) : [],
      suggestions: suggestionsMatch ? suggestionsMatch[1].trim() : '',
      verdict: verdictMatch ? verdictMatch[1].trim() : ''
    };

    res.json(factCheck);

  } catch (error) {
    res.status(500).json({ error: 'Failed to fact check article', details: error.message });
  }
});



app.get('/articles', async (req, res) => {
  try {
    const articles = await prisma.article.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(articles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch articles', details: error.message });
  }
});



app.put('/articles/:id', async (req, res) => {
  const { id } = req.params;
  const { title, notes, category, content, citations, imageIdeas } = req.body;

  try {
    const updatedArticle = await prisma.article.update({
      where: { id },
      data: {
        title,
        notes,
        category,
        content,
        citations,
        imageIdeas
      }
    });
    res.json(updatedArticle);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update article', details: error.message });
  }
});



app.delete('/articles/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await prisma.article.delete({ where: { id } });
    res.json({ message: 'Article deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete article', details: error.message });
  }
});





app.listen(3000, () => {
  console.log('Server is running on port 3000');
});




