// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  methods: ['GET', 'POST']
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Track available users waiting to be matched
const waitingUsers = new Map();
// Track active chat sessions
const activeSessions = new Map();

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // User joins the waiting pool
  socket.on('waiting', (userData) => {
    const { walletAddress } = userData;
    console.log(`User ${socket.id} (${walletAddress}) is waiting for a match`);
    
    // Add user to waiting pool
    waitingUsers.set(socket.id, {
      socketId: socket.id,
      walletAddress,
      joinedAt: Date.now()
    });
    
    // Try to match with another user
    matchUsers();
  });
  
  // Handle WebRTC signaling
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });
  
  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });
  
  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });
  
  // Handle chat ending
  socket.on('end-chat', () => {
    // Find any session involving this socket
    let sessionToEnd = null;
    activeSessions.forEach((session, sessionId) => {
      if (session.user1 === socket.id || session.user2 === socket.id) {
        sessionToEnd = session;
        activeSessions.delete(sessionId);
      }
    });
    
    if (sessionToEnd) {
      const otherUser = sessionToEnd.user1 === socket.id ? 
        sessionToEnd.user2 : sessionToEnd.user1;
      
      io.to(otherUser).emit('chat-ended', { 
        reason: 'Peer ended the chat'
      });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Remove from waiting pool if present
    if (waitingUsers.has(socket.id)) {
      waitingUsers.delete(socket.id);
    }
    
    // End any active session
    activeSessions.forEach((session, sessionId) => {
      if (session.user1 === socket.id || session.user2 === socket.id) {
        const otherUser = session.user1 === socket.id ? 
          session.user2 : session.user1;
        
        io.to(otherUser).emit('chat-ended', { 
          reason: 'Peer disconnected'
        });
        
        activeSessions.delete(sessionId);
      }
    });
  });
});

// Function to match waiting users
function matchUsers() {
  if (waitingUsers.size >= 2) {
    // Sort users by waiting time (FIFO)
    const sortedUsers = [...waitingUsers.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt);
    
    // Get the first two users
    const user1 = sortedUsers[0];
    const user2 = sortedUsers[1];
    
    // Remove them from waiting pool
    waitingUsers.delete(user1.socketId);
    waitingUsers.delete(user2.socketId);
    
    // Create a session ID
    const sessionId = `${user1.socketId}-${user2.socketId}`;
    
    // Store the session
    activeSessions.set(sessionId, {
      user1: user1.socketId,
      user2: user2.socketId,
      user1Wallet: user1.walletAddress,
      user2Wallet: user2.walletAddress,
      startedAt: Date.now()
    });
    
    // Notify both users that they've been matched
    io.to(user1.socketId).emit('matched', {
      peer: user2.socketId,
      peerWallet: user2.walletAddress
    });
    
    io.to(user2.socketId).emit('matched', {
      peer: user1.socketId,
      peerWallet: user1.walletAddress
    });
    
    console.log(`Matched users: ${user1.socketId} and ${user2.socketId}`);
  }
}

// Start the server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});