import { Client, IntentsBitField, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { exec } from 'child_process';

// Lấy đường dẫn thư mục hiện tại
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== CONFIG ======
const GUILD_ID = '1555393892399185960';

// ====== FAKE PORT CHO RENDER ======
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
});

server.listen(PORT, () => {
    console.log(`✅ Fake server running on port ${PORT}`);
});

// ====== GET TOKEN FROM ENVIRONMENT ======
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN not found in environment variables!');
    console.log('📝 Add BOT_TOKEN to Render Environment Variables');
    process.exit(1);
}

// ====== USER TOKEN STORAGE ======
const TOKEN_FILE = path.join(__dirname, 'user-tokens.json');

function loadTokens(): { [userId: string]: string } {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
        }
    } catch (error) {
        console.error('❌ Error reading token file:', error);
    }
    return {};
}

function saveToken(userId: string, token: string): boolean {
    try {
        const tokens = loadTokens();
        tokens[userId] = token;
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
        return true;
    } catch (error) {
        console.error('❌ Error saving token:', error);
        return false;
    }
}

function getUserToken(userId: string): string | null {
    const tokens = loadTokens();
    return tokens[userId] || null;
}

function deleteToken(userId: string): boolean {
    try {
        const tokens = loadTokens();
        delete tokens[userId];
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
        return true;
    } catch (error) {
        console.error('❌ Error deleting token:', error);
        return false;
    }
}

// ====== RUN QUEST IN CHILD PROCESS (FIX CRASH) ======
async function runQuestInChildProcess(token: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // Chạy bot.ts với token truyền vào
        const child = exec(`TOKEN="${token}" npx tsx bot.ts`, {
            cwd: __dirname,
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer
            env: { ...process.env, TOKEN: token }
        });
        
        let output = '';
        let errorOutput = '';
        
        child.stdout?.on('data', (data: string) => {
            output += data;
            console.log(data);
        });
        
        child.stderr?.on('data', (data: string) => {
            errorOutput += data;
            console.error(data);
        });
        
        child.on('close', (code: number) => {
            if (code === 0) {
                resolve(output || 'Quest completed successfully!');
            } else {
                reject(new Error(`Quest failed with code ${code}:\n${errorOutput || output || 'Unknown error'}`));
            }
        });
        
        child.on('error', (err: Error) => {
            reject(err);
        });
    });
}

// ====== BOT SETUP ======
const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.DirectMessages,
    ],
});

let isRunning = false;
const ALLOWED_USERS: string[] = [];

// ====== EMBED HELPER ======
function createEmbed(
    title: string,
    description: string,
    color: number = 0x5865F2,
    fields: { name: string; value: string; inline?: boolean }[] = [],
    thumbnail?: string,
    footer?: string
) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();

    if (fields.length > 0) {
        embed.addFields(fields);
    }

    if (thumbnail) {
        embed.setThumbnail(thumbnail);
    }

    if (footer) {
        embed.setFooter({ text: footer });
    }

    return embed;
}

// ====== REGISTER SLASH COMMANDS ======
client.once('ready', async () => {
    console.log(`✅ Bot online: ${client.user?.tag}`);
    
    const commands = [
        new SlashCommandBuilder()
            .setName('token')
            .setDescription('Save your Discord token')
            .addStringOption(option =>
                option.setName('token')
                    .setDescription('Your Discord user token')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('complete')
            .setDescription('Start auto-complete quest'),
        new SlashCommandBuilder()
            .setName('mytoken')
            .setDescription('View your saved token (partially hidden)'),
        new SlashCommandBuilder()
            .setName('deltoken')
            .setDescription('Delete your saved token'),
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('Show help menu'),
    ];

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    try {
        console.log(`🔄 Registering slash commands for guild ${GUILD_ID}...`);
        await rest.put(
            Routes.applicationGuildCommands(client.user?.id || '', GUILD_ID),
            { body: commands }
        );
        console.log('✅ Slash commands registered!');
        console.log('📋 Commands: /token, /complete, /mytoken, /deltoken, /help');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
});

// ====== HANDLE INTERACTIONS ======
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user } = interaction;

    if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(user.id)) {
        await interaction.reply({
            embeds: [createEmbed(
                '⛔ Access Denied',
                'You do not have permission to use this bot.',
                0xFF0000
            )],
            ephemeral: true
        });
        return;
    }

    // ====== /TOKEN ======
    if (commandName === 'token') {
        const token = interaction.options.getString('token', true);
        
        const saved = saveToken(user.id, token);
        
        if (saved) {
            const masked = token.substring(0, 8) + '...' + token.substring(token.length - 4);
            await interaction.reply({
                embeds: [createEmbed(
                    '✅ Token Saved!',
                    'Your token has been saved successfully.',
                    0x00FF00,
                    [
                        { name: '📌 Token', value: `\`${masked}\``, inline: false },
                        { name: '🆔 User', value: user.tag, inline: true },
                        { name: '💡 Next Step', value: 'Use `/complete` to start quest.', inline: true }
                    ],
                    user.displayAvatarURL()
                )],
                ephemeral: true
            });
            console.log(`🔑 ${user.tag} saved token.`);
        } else {
            await interaction.reply({
                embeds: [createEmbed(
                    '❌ Error!',
                    'Failed to save token. Please try again.',
                    0xFF0000
                )],
                ephemeral: true
            });
        }
        return;
    }

    // ====== /COMPLETE ======
    if (commandName === 'complete') {
        const token = getUserToken(user.id);
        
        if (!token) {
            await interaction.reply({
                embeds: [createEmbed(
                    '❌ No Token Found!',
                    'You haven\'t saved your Discord token yet.',
                    0xFFA500,
                    [
                        { name: '📝 Instructions', value: 'Use `/token <your_token>` to save it first.', inline: false }
                    ]
                )],
                ephemeral: true
            });
            return;
        }

        if (isRunning) {
            await interaction.reply({
                embeds: [createEmbed(
                    '⏳ Already Running!',
                    'A quest is currently in progress. Please wait.',
                    0xF1C40F
                )],
                ephemeral: true
            });
            return;
        }

        isRunning = true;
        const startTime = Date.now();
        
        const startEmbed = createEmbed(
            '🚀 Starting Quest Auto-Complete!',
            'The process is now running...',
            0x5865F2,
            [
                { name: '⏱️ Estimated Time', value: '15-20 minutes', inline: true },
                { name: '🔄 Status', value: '🟢 Running...', inline: true },
                { name: '👤 User', value: user.tag, inline: true }
            ]
        );

        await interaction.reply({ embeds: [startEmbed], ephemeral: true });

        try {
            // Run quest in child process
            const result = await runQuestInChildProcess(token);
            
            const duration = ((Date.now() - startTime) / 60000).toFixed(1);
            
            const successEmbed = createEmbed(
                '✅ Quest Completed!',
                'All quests have been completed successfully.',
                0x00FF00,
                [
                    { name: '📊 Result', value: `\`\`\`\n${result || 'Quest completed successfully!'}\n\`\`\``, inline: false },
                    { name: '⏱️ Duration', value: `${duration} minutes`, inline: true },
                    { name: '👤 User', value: user.tag, inline: true }
                ]
            );
            
            await interaction.followUp({ embeds: [successEmbed] });
            
            console.log(`✅ ${user.tag} completed quest successfully.`);
            
        } catch (error: any) {
            console.error('❌ Quest error:', error);
            
            const errorEmbed = createEmbed(
                '❌ Quest Failed!',
                'An error occurred while running the quest.',
                0xFF0000,
                [
                    { name: 'Error', value: `\`\`\`\n${error.message || 'Unknown error'}\n\`\`\``, inline: false },
                    { name: '💡 Suggestion', value: 'Check your token and try again.', inline: true }
                ]
            );
            
            await interaction.followUp({ embeds: [errorEmbed] });
            
        } finally {
            isRunning = false;
        }
        return;
    }

    // ====== /MYTOKEN ======
    if (commandName === 'mytoken') {
        const token = getUserToken(user.id);
        if (!token) {
            await interaction.reply({
                embeds: [createEmbed(
                    '❌ No Token Found!',
                    'You haven\'t saved your token yet.',
                    0xFFA500,
                    [
                        { name: '📝 Instructions', value: 'Use `/token <your_token>` to save it.', inline: false }
                    ]
                )],
                ephemeral: true
            });
            return;
        }
        const masked = token.substring(0, 8) + '...' + token.substring(token.length - 4);
        await interaction.reply({
            embeds: [createEmbed(
                '🔑 Your Token',
                'This is your saved Discord token.',
                0x5865F2,
                [
                    { name: '📌 Token', value: `\`${masked}\``, inline: false },
                    { name: '🆔 User ID', value: user.id, inline: true }
                ],
                user.displayAvatarURL()
            )],
            ephemeral: true
        });
        return;
    }

    // ====== /DELTOKEN ======
    if (commandName === 'deltoken') {
        const deleted = deleteToken(user.id);
        if (deleted) {
            await interaction.reply({
                embeds: [createEmbed(
                    '🗑️ Token Deleted!',
                    'Your token has been successfully deleted.',
                    0x00FF00
                )],
                ephemeral: true
            });
            console.log(`🗑️ ${user.tag} deleted token.`);
        } else {
            await interaction.reply({
                embeds: [createEmbed(
                    '❌ No Token Found!',
                    'You don\'t have a token to delete.',
                    0xFF0000
                )],
                ephemeral: true
            });
        }
        return;
    }

    // ====== /HELP ======
    if (commandName === 'help') {
        await interaction.reply({
            embeds: [createEmbed(
                '📖 Help Menu',
                'Here are all the available commands:',
                0x5865F2,
                [
                    { name: '🔹 `/token <token>`', value: 'Save your Discord user token', inline: false },
                    { name: '🔹 `/complete`', value: 'Start auto-complete quest', inline: false },
                    { name: '🔹 `/mytoken`', value: 'View your saved token (partially hidden)', inline: false },
                    { name: '🔹 `/deltoken`', value: 'Delete your saved token', inline: false },
                    { name: '🔹 `/help`', value: 'Show this help menu', inline: false }
                ],
                null,
                '⚠️ This is a selfbot - use at your own risk!'
            )],
            ephemeral: true
        });
        return;
    }
});

// ====== LOGIN ======
client.login(BOT_TOKEN).catch((error) => {
    console.error('❌ Login failed:', error);
});
