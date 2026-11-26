/**
 * ============================================================================
 * SISTEM INFORMASI MANAJEMEN STOK GUDANG - PMI KOTA SURAKARTA
 * File: Auth.gs
 * Deskripsi: Sistem autentikasi pengguna, manajemen sesi berbasis token server
 *            (CacheService + PropertiesService), validasi RBAC di sisi server
 *            untuk ADMIN, PETUGAS GUDANG, dan PIMPINAN, serta CRUD pengguna.
 * ============================================================================
 */

var SESSION_TTL_SECONDS = 21600; // 6 Jam

/**
 * Proses Login Pengguna dengan Username dan Password.
 */
function authenticateUser(username, plainPassword) {
  var cleanUser = String(username || '').trim().toLowerCase();
  var cleanPass = String(plainPassword || '');

  if (!cleanUser || !cleanPass) {
    throw new Error('Username dan password wajib diisi.');
  }

  // Pastikan database & akun default sudah terinisialisasi
  var users = getSheetRecords(APP_CONFIG.SHEETS.USERS);
  if (users.length === 0) {
    setupDatabase();
    users = getSheetRecords(APP_CONFIG.SHEETS.USERS);
  }

  var inputHash = hashPassword(cleanPass);
  var foundUser = null;

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (String(u.username || '').trim().toLowerCase() === cleanUser) {
      foundUser = u;
      break;
    }
  }

  if (!foundUser) {
    throw new Error('Username tidak ditemukan.');
  }

  if (String(foundUser.status_aktif || '').toUpperCase() !== 'AKTIF') {
    throw new Error('Akun pengguna ini berstatus NONAKTIF. Hubungi Administrator.');
  }

  var storedHash = String(foundUser.password_hash || '').trim();
  if (storedHash !== inputHash && storedHash !== cleanPass) {
    throw new Error('Password yang Anda masukkan salah.');
  }

  // Buat session token aman
  var token = 'TKN-' + Utilities.getUuid().replace(/-/g, '') + '-' + new Date().getTime();
  var nowStr = getCurrentTimestamp();

  // Update waktu last_login di sheet USERS
  updateSheetRecordById(APP_CONFIG.SHEETS.USERS, 'USERS', 'id_user', foundUser.id_user, {
    last_login: nowStr
  });

  var sessionUser = {
    id_user: foundUser.id_user,
    username: foundUser.username,
    nama_lengkap: foundUser.nama_lengkap,
    role: foundUser.role,
    jabatan: foundUser.jabatan,
    email: foundUser.email,
    no_hp: foundUser.no_hp,
    login_at: nowStr
  };

  saveSessionToken(token, sessionUser);

  logUserActivity(
    sessionUser,
    'AUTH',
    'LOGIN',
    foundUser.id_user,
    'Pengguna berhasil login sebagai ' + foundUser.role
  );

  return {
    token: token,
    user: sessionUser,
    permissions: getRolePermissions(foundUser.role)
  };
}

/**
 * Menyimpan session token ke CacheService dan PropertiesService.
 */
function saveSessionToken(token, sessionUser) {
  var jsonStr = JSON.stringify(sessionUser);
  try {
    CacheService.getScriptCache().put('SESSION_' + token, jsonStr, SESSION_TTL_SECONDS);
  } catch (e) {}
  try {
    PropertiesService.getScriptProperties().setProperty('SESSION_' + token, jsonStr);
  } catch (e2) {}
}

/**
 * Menghapus sesi saat pengguna logout.
 */
function logoutUserSession(token) {
  if (!token) return { success: true };
  var user = getSessionUserFromToken(token);
  if (user) {
    logUserActivity(user, 'AUTH', 'LOGOUT', user.id_user, 'Pengguna keluar (logout) dari aplikasi');
  }
  try {
    CacheService.getScriptCache().remove('SESSION_' + token);
  } catch (e) {}
  try {
    PropertiesService.getScriptProperties().deleteProperty('SESSION_' + token);
  } catch (e2) {}
  return { success: true };
}

/**
 * Mendapatkan objek user dari token sesi aktif.
 */
function getSessionUserFromToken(token) {
  if (!token) return null;
  var key = 'SESSION_' + String(token).trim();
  var raw = null;

  try {
    raw = CacheService.getScriptCache().get(key);
  } catch (e) {}

  if (!raw) {
    try {
      raw = PropertiesService.getScriptProperties().getProperty(key);
      if (raw) {
        CacheService.getScriptCache().put(key, raw, SESSION_TTL_SECONDS);
      }
    } catch (e2) {}
  }

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Mengembalikan matriks permission berdasarkan role pengguna.
 */
function getRolePermissions(role) {
  var cleanRole = String(role || '').toUpperCase().trim();
  return APP_CONFIG.ROLE_PERMISSIONS[cleanRole] || APP_CONFIG.ROLE_PERMISSIONS['PIMPINAN'];
}

/**
 * Validasi Akses di Sisi Server (Server-Side RBAC Guard - Bab 11).
 * Mencegah akses ilegal meskipun pengguna memodifikasi tampilan di frontend.
 */
function requireServerPermission(token, requiredPermissionKey) {
  var sessionUser = getSessionUserFromToken(token);
  if (!sessionUser) {
    var authErr = new Error('Sesi Anda telah berakhir atau belum login. Silakan login kembali.');
    authErr.code = 'UNAUTHORIZED';
    throw authErr;
  }

  // Cek ulang status aktif user dari database
  var users = getSheetRecords(APP_CONFIG.SHEETS.USERS);
  var dbUser = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].id_user) === String(sessionUser.id_user)) {
      dbUser = users[i];
      break;
    }
  }

  if (!dbUser || String(dbUser.status_aktif).toUpperCase() !== 'AKTIF') {
    var inactiveErr = new Error('Akun Anda tidak lagi aktif.');
    inactiveErr.code = 'UNAUTHORIZED';
    throw inactiveErr;
  }

  // Gunakan role terbaru dari database
  sessionUser.role = dbUser.role;
  sessionUser.nama_lengkap = dbUser.nama_lengkap;
  var permissions = getRolePermissions(sessionUser.role);

  if (requiredPermissionKey && !permissions[requiredPermissionKey]) {
    throw new Error(
      'AKSES DITOLAK: Level akses Anda (' +
      sessionUser.role +
      ') tidak memiliki izin untuk melakukan operasi ini (' +
      requiredPermissionKey +
      ').'
    );
  }

  return {
    user: sessionUser,
    permissions: permissions
  };
}

/**
 * Mengambil daftar seluruh pengguna (Hanya untuk ADMIN).
 */
function getAllUsersForAdmin(token) {
  requireServerPermission(token, 'canManageUsers');
  var users = getSheetRecords(APP_CONFIG.SHEETS.USERS);
  var safeUsers = [];

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    safeUsers.push({
      id_user: u.id_user,
      username: u.username,
      nama_lengkap: u.nama_lengkap,
      role: u.role,
      jabatan: u.jabatan,
      email: u.email,
      no_hp: u.no_hp,
      status_aktif: u.status_aktif,
      last_login: u.last_login,
      created_at: u.created_at
    });
  }
  return safeUsers;
}

/**
 * Menambah atau mengedit pengguna oleh ADMIN.
 */
function saveUserAccount(token, payload) {
  var auth = requireServerPermission(token, 'canManageUsers');
  return executeWithWarehouseLock(function() {
    var users = getSheetRecords(APP_CONFIG.SHEETS.USERS);
    var idUser = String(payload.id_user || '').trim();
    var username = String(payload.username || '').trim().toLowerCase();
    var namaLengkap = String(payload.nama_lengkap || '').trim();
    var role = String(payload.role || 'PETUGAS GUDANG').toUpperCase().trim();
    var jabatan = String(payload.jabatan || '').trim();
    var email = String(payload.email || '').trim();
    var noHp = String(payload.no_hp || '').trim();
    var statusAktif = String(payload.status_aktif || 'AKTIF').toUpperCase().trim();
    var plainPass = String(payload.password || '');

    if (!username || !namaLengkap) {
      throw new Error('Username dan Nama Lengkap wajib diisi.');
    }

    if (!APP_CONFIG.ROLE_PERMISSIONS[role]) {
      throw new Error('Role tidak valid. Pilih ADMIN, PETUGAS GUDANG, atau PIMPINAN.');
    }

    // Cek duplikasi username
    for (var i = 0; i < users.length; i++) {
      if (
        String(users[i].username).toLowerCase() === username &&
        String(users[i].id_user) !== idUser
      ) {
        throw new Error('Username "' + username + '" sudah digunakan oleh akun lain.');
      }
    }

    var now = getCurrentTimestamp();

    if (!idUser) {
      if (!plainPass || plainPass.length < 6) {
        throw new Error('Password pengguna baru wajib diisi minimal 6 karakter.');
      }
      var newUser = {
        id_user: generateUniqueId('USR'),
        username: username,
        password_hash: hashPassword(plainPass),
        nama_lengkap: namaLengkap,
        role: role,
        jabatan: jabatan,
        email: email,
        no_hp: noHp,
        status_aktif: statusAktif,
        last_login: '',
        created_at: now,
        updated_at: now
      };
      insertSheetRecord(APP_CONFIG.SHEETS.USERS, 'USERS', newUser);
      logUserActivity(
        auth.user,
        'USERS',
        'CREATE_USER',
        newUser.id_user,
        'Menambahkan pengguna baru: ' + username + ' (' + role + ')'
      );
      return { message: 'Pengguna baru berhasil ditambahkan.', user: newUser };
    } else {
      var updateObj = {
        username: username,
        nama_lengkap: namaLengkap,
        role: role,
        jabatan: jabatan,
        email: email,
        no_hp: noHp,
        status_aktif: statusAktif,
        updated_at: now
      };
      if (plainPass && plainPass.trim() !== '') {
        if (plainPass.length < 6) {
          throw new Error('Password baru minimal 6 karakter.');
        }
        updateObj.password_hash = hashPassword(plainPass);
      }

      var ok = updateSheetRecordById(APP_CONFIG.SHEETS.USERS, 'USERS', 'id_user', idUser, updateObj);
      if (!ok) {
        throw new Error('ID Pengguna tidak ditemukan.');
      }
      logUserActivity(
        auth.user,
        'USERS',
        'UPDATE_USER',
        idUser,
        'Memperbarui akun pengguna: ' + username + ' (' + role + ')'
      );
      return { message: 'Data pengguna berhasil diperbarui.' };
    }
  });
}

/**
 * Menyimpan perubahan pengaturan instansi & pejabat penandatangan laporan (Hanya ADMIN).
 */
function saveApplicationSettings(token, settingsPayload) {
  var auth = requireServerPermission(token, 'canManageSettings');
  return executeWithWarehouseLock(function() {
    var existing = getSheetRecords(APP_CONFIG.SHEETS.SETTINGS);
    var now = getCurrentTimestamp();
    var keys = Object.keys(settingsPayload || {});

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var val = String(settingsPayload[k] || '').trim();
      var found = false;
      for (var j = 0; j < existing.length; j++) {
        if (String(existing[j].setting_key) === k) {
          found = true;
          break;
        }
      }
      if (found) {
        updateSheetRecordById(APP_CONFIG.SHEETS.SETTINGS, 'SETTINGS', 'setting_key', k, {
          setting_value: val,
          updated_at: now,
          updated_by: auth.user.username
        });
      } else {
        insertSheetRecord(APP_CONFIG.SHEETS.SETTINGS, 'SETTINGS', {
          setting_key: k,
          setting_value: val,
          deskripsi: 'Konfigurasi sistem',
          updated_at: now,
          updated_by: auth.user.username
        });
      }
    }

    logUserActivity(
      auth.user,
      'SETTINGS',
      'UPDATE_SETTINGS',
      'CONFIG',
      'Memperbarui pengaturan identitas instansi & pejabat laporan'
    );
    return { message: 'Pengaturan aplikasi berhasil disimpan.' };
  });
}
