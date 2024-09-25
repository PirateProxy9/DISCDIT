const { Client, GatewayIntentBits, Partials } = require('discord.js');
const snoowrap = require('snoowrap');
const axios = require('axios');
const schedule = require('node-schedule');
const winston = require('winston');
require('dotenv').config();

// Discord Bot Setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageTyping,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});
const prefix = '!';
const commandCooldowns = new Map();
const cooldownTime = 30000; // 30 seconds cooldown

// Set up variables for Reddit API
let accessToken = process.env.ACCESS_TOKEN;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const refreshToken = process.env.REFRESH_TOKEN;
const userAgent = 'DiscordRedditBot';
const redditBaseUrl = 'https://www.reddit.com/api/v1/access_token';
const cache = new Map(); // Caching mechanism for posts still not in use prolly in futur Updatesss
let posts = []; // Array to store fetched posts
let currentIndex = 0; // Track current post index
let postMessages = {}; // Store message IDs associated with post IDs
const sentPostUrls = new Set(); // To track URLs of sent posts

// Set up logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Function to refresh the access token
async function refreshAccessToken() {
    try {
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const response = await axios.post(
            redditBaseUrl,
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            }),
            {
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );
        accessToken = response.data.access_token;
        logger.info('New Access Token:', { accessToken });
    } catch (error) {
        logger.error('Failed to refresh access token:', error.response?.data || error.message);
        throw new Error('Could not refresh Reddit access token. Please check your credentials.');
    }
}

// Reddit API Setup
const reddit = new snoowrap({
    userAgent: userAgent,
    clientId: clientId,
    clientSecret: clientSecret,
    refreshToken: refreshToken,
    accessToken: accessToken
});

// Channel to post updates
const CHANNEL_ID = '';  // Put a valid Discord Channel ID mf :skull:
const SUBREDDIT_NAME = ''; // Adjust this to your corresponding Subreddit

// Ready Event
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    schedule.scheduleJob('*/10 * * * *', async () => {
        try {
            await fetchNewPosts();
        } catch (error) {
            console.error('Scheduled post fetching failed:', error);
            logger.error('Scheduled post fetching failed:', error);
        }
    }); // Scheduled updates every 10 minutes
});

// Fetch new posts from the subreddit
// Update the fetchNewPosts function to use the set subreddit and channel
async function fetchNewPosts() {
    try {
        await refreshAccessToken();
        const subreddit = subredditSettings[client.guilds.cache.first().id] || SUBREDDIT_NAME; // Default if none set
        posts = await reddit.getSubreddit(subreddit).getNew({ limit: 1 }); // Fetch the latest post
        currentIndex = 0; // Reset the index

        if (posts.length > 0) {
            for (let post of posts) {
                if (!sentPostUrls.has(post.url)) {
                    // If the post URL is not in the set, send it and track it
                    await sendPostEmbed(post);
                    sentPostUrls.add(post.url); // Add the URL to the set after sending
                } else {
                    logger.info(`Duplicate post skipped: ${post.url}`);
                }
            }
        } else {
            logger.warn('No posts were fetched.');
        }
    } catch (error) {
        logger.error('Failed to fetch new posts:', error.response?.data || error.message);
    }
}
// Update the sendPostEmbed function to use the set channel
async function sendPostEmbed(post) {
    try {
        const embed = await createEmbed(post);
        const guildId = client.guilds.cache.first().id;
        const channelId = channelSettings[guildId] || CHANNEL_ID; // Default if none set
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            throw new Error('Channel not found.');
        }

        // Send the embed with buttons
        const botMessage = await channel.send({ embeds: [embed], components: createButtons() });
        postMessages[botMessage.id] = post.id; // Store message ID and associated post ID
    } catch (error) {
        logger.error('Failed to send post embed:', error.message);
        console.error('Failed to send post embed:', error);
    }
}
// Create embed for posts
async function createEmbed(post) {
    try {
        const topComment = await fetchTopComment(post.id);
        const upvotes = post.ups || 0;
        const downvotes = post.downs || 0;
        
        return {
            title: post.title,
            description: post.selftext || '[Link to post](' + post.url + ')',
            url: 'https://reddit.com' + post.permalink,
            color: 0xFF4500,
            footer: { text: `Posted in r/${SUBREDDIT_NAME}` },
            image: { url: post.url_overridden_by_dest }, // Display image if available
            fields: [
                { name: 'Top Comment', value: topComment || 'No comments yet.' },
                { name: 'Upvotes', value: upvotes.toString(), inline: true },
                { name: 'Downvotes', value: downvotes.toString(), inline: true }
            ]
        };
    } catch (error) {
        logger.error('Failed to create embed:', error.message);
        return { title: 'Error creating post embed.', description: 'Failed to fetch or display post content.' };
    }
}


// Fetch the top comment for a post
async function fetchTopComment(postId) {
    try {
        const post = await reddit.getSubmission(postId).expandReplies({ limit: 1, depth: 1 });
        return post.comments[0]?.body || 'No comments yet.';
    } catch (error) {
        logger.error('Failed to fetch top comment:', error.message);
        return 'Error fetching top comment.';
    }
}

// Create buttons for navigation and comments
function createButtons() {
    return [
        {
            type: 1, // Action Row
            components: [
                {
                    type: 2, // Button
                    style: 1, // Primary
                    label: 'Previous',
                    customId: 'previous_post'
                },
                {
                    type: 2, // Button
                    style: 1, // Primary
                    label: 'Next',
                    customId: 'next_post'
                },
                {
                    type: 2, // Button
                    style: 1, // Primary
                    label: 'Comments',
                    customId: 'show_comments'
                }
            ]
        }
    ];
}

// Handle button interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    try {
        if (interaction.customId === 'previous_post') {
            currentIndex = (currentIndex > 0) ? currentIndex - 1 : posts.length - 1; // Loop to the last post
        } else if (interaction.customId === 'next_post') {
            currentIndex = (currentIndex < posts.length - 1) ? currentIndex + 1 : 0; // Loop to the first post
        } else if (interaction.customId === 'show_comments') {
            await showTopComments(posts[currentIndex], interaction);
            return; // Prevent the regular update from running
        }

        await interaction.update({ embeds: [await createEmbed(posts[currentIndex])], components: createButtons() });
    } catch (error) {
        logger.error('Interaction failed:', error.message);
        await interaction.reply({ content: 'An error occurred while handling the interaction.', ephemeral: true });
    }
});

// Function to fetch and display comments
async function showTopComments(post, interaction) {
    try {
        const submission = await reddit.getSubmission(post.id).expandReplies({ limit: 5, depth: 1 }); // Get top 5 comments
        const comments = submission.comments.slice(0, 5); // Slice to get top 5 comments

        const commentList = comments.map((comment, index) => {
            const username = comment.author?.name || 'Unknown User'; // Fetch username or set to 'Unknown User'
            return `**${index + 1}.** ${username}: ${comment.body}`;
        }).join('\n') || 'No comments available.';
        
        const commentsEmbed = {
            title: `Top Comments for "${post.title}"`,
            description: commentList,
            url: 'https://reddit.com' + post.permalink,
            color: 0xFF4500
        };

        await interaction.reply({ embeds: [commentsEmbed], ephemeral: true }); // Send comments as a reply
    } catch (error) {
        logger.error('Failed to fetch comments for the post:', error.message);
        await interaction.reply({ content: 'Failed to fetch comments for the post.', ephemeral: true });
    }
}

// Add these lines to store user-specific subreddit and channel settings
const subredditSettings = {}; // Maps Guild IDs to subreddit settings
const channelSettings = {}; // Maps Guild IDs to channel settings

// Command handling
client.on('messageCreate', async message => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Ensure only admins or higher can use these commands
    const member = message.guild.members.cache.get(message.author.id);
    if (command === 'setsubreddit' || command === 'setchannel') {
        if (!member.permissions.has('ADMINISTRATOR')) {
            return message.reply('You do not have permission to use this command.');
        }
    }

    // Check for command cooldown
    if (commandCooldowns.has(message.author.id)) {
        const lastCommandTime = commandCooldowns.get(message.author.id);
        const now = Date.now();
        const timeSinceLastCommand = now - lastCommandTime;

        if (timeSinceLastCommand < cooldownTime) {
            const timeLeft = Math.ceil((cooldownTime - timeSinceLastCommand) / 1000);
            return message.reply(`Please wait ${timeLeft} more second(s) before using that command again.`);
        }
    }

    // Set the cooldown
    commandCooldowns.set(message.author.id, Date.now());

    if (command === 'setsubreddit') {
        const subreddit = args[0];
        if (!subreddit) {
            return message.reply('Please provide a valid subreddit name.');
        }
        subredditSettings[message.guild.id] = subreddit;
        return message.reply(`Subreddit set to r/${subreddit}.`);
    } else if (command === 'setchannel') {
        const channelId = args[0];
        const channel = message.guild.channels.cache.get(channelId) || message.mentions.channels.first();
        if (!channel) {
            return message.reply('Please provide a valid channel ID or mention.');
        }
        channelSettings[message.guild.id] = channel.id;
        return message.reply(`Channel set to ${channel}.`);
    } else if (command === 'help') {
        return message.reply(`
        **Bot Commands:**
        - \`!setsubreddit <subreddit>\` - Sets the subreddit to monitor. (Admins only)
        - \`!setchannel <channel>\` - Sets the channel where updates will be posted. (Admins only)
        - \`!fetch\` - Fetches the latest posts from the set subreddit.
        - \`!comments <postId>\` - Fetches top comments from a specific post.
        `);
    } else if (command === 'fetch') {
        try {
            await fetchNewPosts();
            await message.reply('New posts fetched and displayed.');
        } catch (error) {
            console.error('Command error:', error);
            logger.error('Fetch command error:', error);
            message.reply('Failed to fetch new posts.');
        }
    } else if (command === 'comments') {
        try {
            const postId = args[0];
            if (!postId) {
                return message.reply('Please provide a valid post ID.');
            }
            await showTopComments({ id: postId }, message);
        } catch (error) {
            console.error('Command error:', error);
            logger.error('Comments command error:', error);
            message.reply('Failed to fetch comments.');
        }
    }
});


client.login(process.env.BOT_TOKEN);
