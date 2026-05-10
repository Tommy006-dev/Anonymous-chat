const socket = io(); // Đảm bảo URL này khớp với port Backend của bạn

// --- DOM ELEMENTS & STATE ---
const screens = {
    lobby: document.getElementById('lobby-screen'),
    profile: document.getElementById('profile-screen'),
    chat: document.getElementById('chat-screen')
};

let state = { roomId: null, roomPassword: '', roomName: '', myUsername: '' };
let pendingRoom = null; 
let typingTimeouts = {}; 
let globalRooms = []; 

// Hàm chuyển đổi giữa các màn hình
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
}

// ==========================================
// 1. MÀN HÌNH LOBBY, TÌM KIẾM & MẬT KHẨU
// ==========================================

// Lấy danh sách phòng từ Server
socket.on('room_list', (rooms) => {
    globalRooms = rooms;
    renderRoomList(globalRooms);
});

// Chức năng tìm kiếm phòng trực tiếp (Client-side)
document.getElementById('search-room-input').addEventListener('input', (e) => {
    const keyword = e.target.value.toLowerCase().trim();
    const filteredRooms = globalRooms.filter(r => 
        r.name.toLowerCase().includes(keyword) || r.id.toLowerCase().includes(keyword)
    );
    renderRoomList(filteredRooms);
});

// Hàm render danh sách phòng ra giao diện
function renderRoomList(roomsToRender) {
    const list = document.getElementById('room-list');
    list.innerHTML = '';
    
    if(roomsToRender.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #888; padding: 20px;">Không tìm thấy phòng nào.</p>';
        return;
    }

    roomsToRender.forEach(room => {
        const card = document.createElement('div');
        card.className = 'room-card';
        card.innerHTML = `
            <div class="room-card-info">
                <h3>${room.name} ${room.hasPass ? '<span class="lock-icon">🔒</span>' : ''}</h3>
                <p>ID: ${room.id}</p>
            </div>
            <button class="btn-join-quick">Tham gia</button>
        `;
        
        card.onclick = () => {
            if (room.hasPass) {
                // Hiện Modal nhập pass
                pendingRoom = room;
                document.getElementById('pwd-room-name').innerText = `Mật khẩu phòng "${room.name}"`;
                document.getElementById('room-pwd-input').value = '';
                document.getElementById('password-modal').classList.remove('hidden');
            } else {
                proceedToProfile(room, '');
            }
        };
        list.appendChild(card);
    });
}

// Check mật khẩu bằng API verify_password
document.getElementById('btn-confirm-pwd').onclick = () => {
    const pwd = document.getElementById('room-pwd-input').value;
    socket.emit('verify_password', { roomId: pendingRoom.id, password: pwd });
};

// Kết quả check pass từ server
socket.on('password_result', (res) => {
    if (res.success) {
        document.getElementById('password-modal').classList.add('hidden');
        proceedToProfile(pendingRoom, document.getElementById('room-pwd-input').value);
    } else {
        alert(res.msg); // Sai pass, giữ nguyên popup để nhập lại
    }
});

// Hủy popup nhập pass
document.getElementById('btn-cancel-pwd').onclick = () => {
    document.getElementById('password-modal').classList.add('hidden');
    pendingRoom = null;
};

// Chuẩn bị thông tin chuyển sang màn Profile
function proceedToProfile(room, password) {
    state.roomId = room.id;
    state.roomName = room.name;
    state.roomPassword = password;
    document.getElementById('selected-room-name').innerText = `Chuẩn bị vào: ${room.name}`;
    document.getElementById('username-input').value = ''; // Clear tên cũ nếu có
    showScreen('profile');
}

// Giao diện Tạo phòng
document.getElementById('btn-show-create-room').onclick = () => {
    document.getElementById('create-room-form').classList.toggle('hidden');
};
document.getElementById('btn-cancel-create').onclick = () => {
    document.getElementById('create-room-form').classList.add('hidden');
};

document.getElementById('btn-create-room').onclick = () => {
    const name = document.getElementById('new-room-name').value.trim();
    const pass = document.getElementById('new-room-pass').value.trim();
    if(name) {
        socket.emit('create_room', { name: name, password: pass });
        document.getElementById('new-room-name').value = '';
        document.getElementById('new-room-pass').value = '';
        document.getElementById('create-room-form').classList.add('hidden');
    } else {
        alert("Vui lòng nhập tên phòng");
    }
};

socket.on('room_created', (roomId) => {
    alert(`Tạo phòng thành công! ID phòng của bạn là: ${roomId}`);
});


// ==========================================
// 2. MÀN HÌNH PROFILE & BẮT LỖI
// ==========================================

document.getElementById('btn-back-lobby').onclick = () => showScreen('lobby');

document.getElementById('btn-join-room').onclick = () => {
    const username = document.getElementById('username-input').value.trim();
    if (!username) return alert("Vui lòng nhập biệt danh!");

    const gender = document.querySelector('input[name="gender"]:checked').value;
    
    const userProfile = { username, gender, avatar: '' }; // Avatar server tự xử lý

    socket.emit('join_room', {
        roomId: state.roomId,
        password: state.roomPassword,
        userProfile: userProfile
    });
};

// Lỗi chung (Bao gồm trùng tên)
socket.on('error_msg', (msg) => {
    alert("Lỗi: " + msg);
    // Nếu lỗi mất phòng hoặc bypass sai pass thì đá ra lobby, còn trùng tên thì ở lại sửa
    if(msg === 'Phòng không tồn tại!' || msg === 'Sai mật khẩu!') {
        showScreen('lobby');
    }
});

socket.on('join_success', (data) => {
    state.myUsername = data.profile.username;
    document.getElementById('current-room-title').innerText = data.roomName;
    document.getElementById('chat-box').innerHTML = ''; // Reset khung chat
    showScreen('chat');
});


// ==========================================
// 3. MÀN HÌNH CHAT CHÍNH
// ==========================================

// Cập nhật danh sách Live Count
socket.on('update_members', (members) => {
    document.getElementById('live-count').innerText = `🟢 Đang online: ${members.length}`;
    const list = document.getElementById('member-list');
    list.innerHTML = '';
    
    members.forEach(m => {
        const li = document.createElement('li');
        li.className = 'member-item';
        const genderIcon = m.gender === 'Nam' ? '♂' : '♀';
        const genderClass = m.gender === 'Nam' ? 'gender-Nam' : 'gender-Nữ';
        li.innerHTML = `
            <img src="${m.avatar}" class="avatar">
            <span>${m.username} <span class="${genderClass}">${genderIcon}</span></span>
        `;
        list.appendChild(li);
    });
});

// Nhận tin nhắn và vẽ bong bóng chat
socket.on('receive_message', (data) => {
    // Xóa hiệu ứng "Đang gõ" của người này ngay lập tức nếu có
    const typingIndicator = document.getElementById(`typing-${data.sender}`);
    if (typingIndicator) typingIndicator.remove();

    const isMine = data.sender === state.myUsername;
    const wrapperClass = isMine ? 'wrapper-my' : 'wrapper-other';
    const bubbleClass = isMine ? 'my-bubble' : 'other-bubble';
    const genderIcon = data.gender === 'Nam' ? '♂' : '♀';
    
    // Nếu là mình thì không cần hiện tên
    const infoHtml = isMine ? '' : `
        <div class="sender-name">
            ${data.sender} <span style="color: ${data.gender==='Nam'?'#0084ff':'#e91e63'}">${genderIcon}</span>
        </div>
    `;

    const htmlContent = `
        ${!isMine ? `<img src="${data.avatar}" class="avatar">` : ''}
        <div class="msg-content">
            ${infoHtml}
            <div class="bubble ${bubbleClass}">${data.text}</div>
            <div class="timestamp">${data.timestamp}</div>
        </div>
    `;

    const messageDiv = document.createElement('div');
    messageDiv.className = `msg-wrapper ${wrapperClass}`;
    messageDiv.innerHTML = htmlContent;
    
    const chatBox = document.getElementById('chat-box');
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// ---- XỬ LÝ HIỆU ỨNG ĐANG GÕ (TYPING) ----
const messageInput = document.getElementById('message-input');

// Gửi event lên server khi có thao tác gõ phím
messageInput.addEventListener('input', () => {
    socket.emit('typing');
});

// Nhận event ai đó đang gõ
socket.on('user_typing', (data) => {
    const typingId = `typing-${data.username}`;
    const chatBox = document.getElementById('chat-box');
    
    // Nếu chưa có bóng gõ của người này thì tạo mới
    if (!document.getElementById(typingId)) {
        const typingDiv = document.createElement('div');
        typingDiv.id = typingId;
        typingDiv.className = 'msg-wrapper wrapper-other';
        typingDiv.innerHTML = `
            <div class="msg-content">
                <div class="sender-name">${data.username}</div>
                <div class="typing-bubble">
                    <div class="dot"></div><div class="dot"></div><div class="dot"></div>
                </div>
            </div>
        `;
        chatBox.appendChild(typingDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Xóa bộ hẹn giờ cũ
    clearTimeout(typingTimeouts[data.username]);
    
    // Đặt lại bộ hẹn giờ, nếu dừng gõ 5 giây thì xóa
    typingTimeouts[data.username] = setTimeout(() => {
        const indicator = document.getElementById(typingId);
        if (indicator) indicator.remove();
    }, 5000);
});

// Tin nhắn hệ thống (Ai đó vào/ra)
socket.on('system_message', (data) => {
    const chatBox = document.getElementById('chat-box');
    const div = document.createElement('div');
    div.className = 'system-message';
    div.innerText = data.message;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// ---- GỬI TIN NHẮN ----
function sendMessage() {
    const text = messageInput.value.trim();
    if (text !== '') {
        socket.emit('send_message', { text: text });
        messageInput.value = '';
    }
}

document.getElementById('send-btn').onclick = sendMessage;

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Rời phòng bằng cách tải lại trang
document.getElementById('btn-leave-room').onclick = () => {
    if(confirm("Bạn có chắc chắn muốn rời phòng?")) {
        window.location.reload(); 
    }
};