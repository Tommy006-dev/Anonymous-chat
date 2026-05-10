const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('frontend')); // Phục vụ file tĩnh từ thư mục "frontend"
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ----------------------------------------------------
// DATABASE TẠM THỜI (Lưu trên RAM)
// ----------------------------------------------------
const rooms = {
  'global': { 
    id: 'global', 
    name: 'Cộng đồng', 
    password: '', 
    members: {} 
  }
};

io.on('connection', (socket) => {
  console.log(`🟢 [KẾT NỐI MỚI] Khách vừa truy cập web (Socket ID: ${socket.id})`);

  // 1. Gửi danh sách phòng cho khách mới
  socket.emit('room_list', Object.values(rooms).map(r => ({
    id: r.id, name: r.name, hasPass: r.password !== ''
  })));

  // 2. Xử lý tạo phòng
  socket.on('create_room', (data) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const roomName = data.name || `Phòng ${roomId}`;
    rooms[roomId] = {
      id: roomId,
      name: roomName,
      password: data.password || '',
      members: {}
    };
    
    console.log(`🏠 [TẠO PHÒNG] Socket ${socket.id} đã tạo phòng mới: "${roomName}" (ID: ${roomId}) ${data.password ? '[Có Pass]' : '[Không Pass]'}`);

    io.emit('room_list', Object.values(rooms).map(r => ({
      id: r.id, name: r.name, hasPass: r.password !== ''
    })));
    socket.emit('room_created', roomId);
  });

  // 3. XỬ LÝ XÁC THỰC MẬT KHẨU TỪ SỚM
  socket.on('verify_password', (data) => {
    const room = rooms[data.roomId];
    if (!room) {
        return socket.emit('password_result', { success: false, msg: 'Phòng không tồn tại!' });
    }
    
    if (room.password !== '' && room.password !== data.password) {
      console.log(`🔑 [CẢNH BÁO] Socket ${socket.id} nhập SAI mật khẩu phòng "${room.name}" (ID: ${data.roomId})`);
      return socket.emit('password_result', { success: false, msg: 'Sai mật khẩu! Vui lòng thử lại.' });
    }
    
    // Đúng mật khẩu
    socket.emit('password_result', { success: true });
  });

  // 4. XỬ LÝ THAM GIA PHÒNG & KIỂM TRA TRÙNG TÊN
  socket.on('join_room', (data) => {
    try {
        const { roomId, password, userProfile } = data;
        const room = rooms[roomId];

        if (!room) return socket.emit('error_msg', 'Phòng không tồn tại!');
        if (room.password !== '' && room.password !== password) {
          return socket.emit('error_msg', 'Sai mật khẩu!');
        }

        // KIỂM TRA TRÙNG TÊN
        if (userProfile && userProfile.username) {
            const isDuplicate = Object.values(room.members).some(
              m => m.username.toLowerCase() === userProfile.username.toLowerCase()
            );
            
            if (isDuplicate) {
              console.log(`⚠️ [TỪ CHỐI] Socket ${socket.id} cố gắng dùng tên đã tồn tại: "${userProfile.username}" trong phòng "${room.name}"`);
              return socket.emit('error_msg', 'Tên này đã có người sử dụng trong phòng. Vui lòng chọn tên khác!');
            }
        } else {
            return socket.emit('error_msg', 'Thông tin tên không hợp lệ!');
        }

        // Rời phòng cũ nếu có
        if (socket.currentRoom && rooms[socket.currentRoom]) {
          const oldRoomId = socket.currentRoom;
          socket.leave(oldRoomId);
          delete rooms[oldRoomId].members[socket.id];
          
          console.log(`🚪 [RỜI PHÒNG] "${socket.userProfile?.username}" đã rời phòng "${rooms[oldRoomId].name}" để chuyển phòng.`);
          
          io.to(oldRoomId).emit('update_members', Object.values(rooms[oldRoomId].members));
          io.to(oldRoomId).emit('system_message', { 
            message: `${socket.userProfile?.username || 'Một người'} đã rời phòng.` 
          });
        }

        // Gán Avatar mặc định dựa theo giới tính
        let finalAvatar = userProfile.avatar;
        if (!finalAvatar || finalAvatar.trim() === '') {
          finalAvatar = userProfile.gender === 'Nam' 
            ? 'https://cdn-icons-png.flaticon.com/512/4128/4128176.png'  
            : 'https://cdn-icons-png.flaticon.com/512/6997/6997662.png'; 
        }
        userProfile.avatar = finalAvatar;

        socket.currentRoom = roomId;
        socket.userProfile = userProfile;

        // Vào phòng
        socket.join(roomId);
        room.members[socket.id] = { ...userProfile, socketId: socket.id };

        console.log(`👤 [VÀO PHÒNG] "${userProfile.username}" (${userProfile.gender}) đã tham gia phòng "${room.name}" (ID: ${roomId}). Tổng mem: ${Object.keys(room.members).length}`);

        socket.emit('join_success', { roomId: roomId, roomName: room.name, profile: userProfile });
        io.to(roomId).emit('update_members', Object.values(room.members));
        io.to(roomId).emit('system_message', { 
          message: `${userProfile.username} đã tham gia phòng chat.` 
        });

    } catch (error) {
        console.error("❌ [LỖI SERVER] Lỗi khi xử lý join_room:", error);
        socket.emit('error_msg', 'Đã xảy ra lỗi trên máy chủ, vui lòng thử lại!');
    }
  });

  // 5. Gửi tin nhắn
  socket.on('send_message', (data) => {
    const roomId = socket.currentRoom;
    const profile = socket.userProfile;
    if (roomId && profile) {
      
      console.log(`💬 [CHAT - ${rooms[roomId]?.name || roomId}] ${profile.username}: ${data.text}`);

      io.to(roomId).emit('receive_message', {
        sender: profile.username,
        gender: profile.gender,
        avatar: profile.avatar,
        text: data.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  // 6. Typing (Đang gõ)
  socket.on('typing', () => {
    const roomId = socket.currentRoom;
    const profile = socket.userProfile;
    if (roomId && profile) {
      socket.to(roomId).emit('user_typing', { username: profile.username });
    }
  });

  // 7. Thoát web / Ngắt kết nối
  socket.on('disconnect', () => {
    const roomId = socket.currentRoom;
    const profile = socket.userProfile;

    if (roomId && rooms[roomId]) {
      const roomName = rooms[roomId].name;
      delete rooms[roomId].members[socket.id];
      
      io.to(roomId).emit('update_members', Object.values(rooms[roomId].members));
      
      if (profile) {
        console.log(`🔴 [NGẮT KẾT NỐI] "${profile.username}" đã thoát web và rời phòng "${roomName}".`);
        io.to(roomId).emit('system_message', { 
          message: `${profile.username} đã rời phòng.` 
        });
      } else {
        console.log(`🔴 [NGẮT KẾT NỐI] Khách vãng lai (Socket ID: ${socket.id}) đã thoát.`);
      }

      // Xóa phòng nếu trống (trừ phòng Cộng đồng)
      if (Object.keys(rooms[roomId].members).length === 0 && roomId !== 'global') {
        delete rooms[roomId];
        console.log(`🗑️ [XÓA PHÒNG] Đã tự động xóa phòng "${roomName}" (ID: ${roomId}) vì không còn ai bên trong.`);
        
        io.emit('room_list', Object.values(rooms).map(r => ({
          id: r.id, name: r.name, hasPass: r.password !== ''
        })));
      }
    } else {
      console.log(`🔴 [NGẮT KẾT NỐI] Khách chưa vào phòng nào (Socket ID: ${socket.id}) đã thoát.`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 BẢNG ĐIỀU KHIỂN SERVER ADMIN`);
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
  console.log(`=========================================`);
});