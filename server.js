const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = 3000;

// Spribe Style স্টেট স্ট্রাকচার
let gameState = {
    status: "BETTING",   
    multiplier: 1.00,
    timer: 10,
    crashPoint: 0,
    activeBets: [], // এখানে Spribe এর মতো অবজেক্ট অ্যারে থাকবে
    history: []     
};

function generateCrashPoint() {
    const houseEdge = 0.03;
    const r = 1 - Math.random() * (1 - houseEdge);
    return parseFloat((1 / r).toFixed(2));
}

function gameLoop() {
    if (gameState.status === "BETTING") {
        if (gameState.timer > 0) {
            gameState.timer--;
            io.emit('sync', { ...gameState, crashPoint: 0 }); // ক্লায়েন্টের কাছে নিরাপদ সিঙ্ক
            setTimeout(gameLoop, 1000);
        } else {
            gameState.status = "FLYING";
            gameState.multiplier = 1.00;
            gameState.crashPoint = generateCrashPoint();
            console.log("Spribe Match Engine - Crash Point:", gameState.crashPoint);
            gameLoop();
        }
    } else if (gameState.status === "FLYING") {
        if (gameState.multiplier < gameState.crashPoint) {
            const increment = 0.01 * Math.pow(gameState.multiplier, 0.5);
            gameState.multiplier = parseFloat((gameState.multiplier + increment).toFixed(2));
            
            // লাইভ ওড়ার সময় অ্যাডমিন রুমে আসল ভ্যালু ব্রডকাস্ট
            io.to('admins').emit('admin_sync', gameState);
            // সাধারণ প্লেয়ারের জন্য মাস্কড সিঙ্ক
            io.emit('sync', { ...gameState, crashPoint: 0 });
            
            setTimeout(gameLoop, 100);
        } else {
            gameState.status = "CRASHED";
            gameState.history.unshift(gameState.multiplier);
            if (gameState.history.length > 15) gameState.history.pop();
            
            io.emit('sync', gameState); // ক্র্যাশ মুহূর্তে আসল ভ্যালু পুশ

            setTimeout(() => {
                gameState.status = "BETTING";
                gameState.timer = 10;
                gameState.activeBets = [];
                gameState.crashPoint = 0;
                gameState.multiplier = 1.00;
                gameLoop();
            }, 4000);
        }
    }
}

io.on('connection', (socket) => {
    socket.emit('sync', { ...gameState, crashPoint: 0 });

    // অ্যাডমিন রুম ভেরিফিকেশন
    socket.on('admin_login', (password) => {
        if (password === 'admin123') {
            socket.join('admins');
            socket.emit('admin_ok', true);
            socket.emit('admin_sync', gameState);
        } else {
            socket.emit('admin_ok', false);
        }
    });

    // স্প্রাইব ফরম্যাট ইউজার ভ্যালু রিসিভার
    socket.on('place_bet', (data) => {
        if (gameState.status !== "BETTING") return;
        
        const amount = Math.abs(parseFloat(data.amount));
        if (isNaN(amount) || amount <= 0) return;

        if (gameState.activeBets.some(b => b.id === socket.id)) return;

        // অরিজিনাল স্প্রাইবের মতো ইউজার অবজেক্ট মেমরি ম্যাপিং
        gameState.activeBets.push({
            id: socket.id,
            user: data.user ? String(data.user) : `User_${socket.id.slice(0, 5)}`,
            amount: amount,
            cashed: false,
            cashedAt: null
        });
        io.emit('sync', { ...gameState, crashPoint: 0 });
    });

    socket.on('claim_cashout', () => {
        if (gameState.status !== "FLYING") return;
        
        let bet = gameState.activeBets.find(b => b.id === socket.id && !b.cashed);
        if (!bet) return;

        bet.cashed = true;
        bet.cashedAt = gameState.multiplier;
        
        socket.emit('cashout_ok', {
            win: (bet.amount * gameState.multiplier).toFixed(2),
            multiplier: gameState.multiplier
        });
        io.emit('sync', { ...gameState, crashPoint: 0 });
    });

    socket.on('disconnect', () => {
        gameState.activeBets = gameState.activeBets.filter(b => b.id !== socket.id);
        io.emit('sync', { ...gameState, crashPoint: 0 });
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
server.listen(PORT, () => {
    console.log(`Aviator Engine Running: http://localhost:${PORT}`);
    gameLoop();
});
