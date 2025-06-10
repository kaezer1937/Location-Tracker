// --- Global Variables and Constants ---
const map = L.map('map').setView([0, 0], 2); // Initial view for world map
const nominatimApiBaseUrl = 'https://nominatim.openstreetmap.org/reverse?format=json';
const LOCAL_STORAGE_USERS_KEY = 'multiUserTracker_users';
const LOCAL_STORAGE_ACTIVE_USER_KEY = 'multiUserTracker_activeUser';

let users = {}; // Simulated user database: { userId: { name, email, location, marker } }
let activeUserId = null;
let userMarkers = {}; // Stores Leaflet marker objects by userId

// --- DOM Elements ---
const userForm = document.getElementById('userForm');
const userNameInput = document.getElementById('userName');
const userEmailInput = document.getElementById('userEmail');
const activeUserDisplay = document.getElementById('activeUserDisplay');
const userListUl = document.querySelector('#userList ul');
const locationUserName = document.getElementById('locationUserName');
const locationUserEmail = document.getElementById('locationUserEmail');
const locationText = document.getElementById('locationText');

// --- Leaflet Map Setup ---
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

// --- Utility Functions ---

// Generate a simple unique ID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Save users to Local Storage
function saveUsers() {
  const usersToSave = Object.fromEntries(
    Object.entries(users).map(([id, user]) => {
      const { marker, ...rest } = user; // Destructure to exclude marker
      return [id, rest];
    })
  );
  localStorage.setItem(LOCAL_STORAGE_USERS_KEY, JSON.stringify(usersToSave));
}

// Load users from Local Storage
function loadUsers() {
  const storedUsers = localStorage.getItem(LOCAL_STORAGE_USERS_KEY);
  if (storedUsers) {
    const parsedUsers = JSON.parse(storedUsers);
    users = {}; // Reset users object
    for (const id in parsedUsers) {
      const user = parsedUsers[id];
      users[id] = user;
      // Recreate markers when loading, if location data exists
      if (user.location && user.location.latitude && user.location.longitude) {
        const marker = L.marker([user.location.latitude, user.location.longitude])
                        .addTo(map)
                        .bindPopup(`<b>${user.name}</b><br>${user.location.address || 'Locating...'}`);
        userMarkers[id] = marker;
        users[id].marker = marker; // Store the Leaflet marker object
      }
    }
  }
  const storedActiveUserId = localStorage.getItem(LOCAL_STORAGE_ACTIVE_USER_KEY);
  if (storedActiveUserId && users[storedActiveUserId]) {
    activeUserId = storedActiveUserId;
    updateActiveUserDisplay();
  }
  renderUserList();
}

// --- User Management Functions ---

function registerUser(name, email) {
  const userId = generateUUID();
  const newUser = {
    id: userId,
    name: name,
    email: email,
    location: null, // Will be updated by geolocation
  };
  users[userId] = newUser;
  saveUsers();
  renderUserList();
  setActiveUser(userId); // Automatically make new user active
}

function setActiveUser(userId) {
  if (users[userId]) {
    activeUserId = userId;
    localStorage.setItem(LOCAL_STORAGE_ACTIVE_USER_KEY, userId);
    updateActiveUserDisplay();
    // Update location details panel
    locationUserName.textContent = users[userId].name;
    locationUserEmail.textContent = users[userId].email;
    // Optionally, center map on this user's last known location if available
    if (users[userId].location && users[userId].location.latitude) {
        map.setView([users[userId].location.latitude, users[userId].location.longitude], 13);
    } else {
        map.setView([0,0], 2); // Reset view if no location
    }
  }
}

function updateActiveUserDisplay() {
  if (activeUserId && users[activeUserId]) {
    activeUserDisplay.textContent = `Current active user: ${users[activeUserId].name} (${users[activeUserId].email})`;
  } else {
    activeUserDisplay.textContent = 'Current active user: None';
  }
}

function renderUserList() {
  userListUl.innerHTML = ''; // Clear existing list
  for (const id in users) {
    const user = users[id];
    const li = document.createElement('li');
    li.innerHTML = `
      <div><strong>${user.name}</strong> (${user.email})</div>
      <div style="font-size: 0.9em; color: #555;">
        Last known: ${user.location ? user.location.address || `${user.location.latitude.toFixed(5)}, ${user.location.longitude.toFixed(5)}` : 'No location'}
      </div>
      <button data-user-id="${id}" class="set-active-btn">Set Active</button>
    `;
    userListUl.appendChild(li);
  }

  // Add event listeners for "Set Active" buttons
  document.querySelectorAll('.set-active-btn').forEach(button => {
    button.addEventListener('click', (event) => {
      const userId = event.target.dataset.userId;
      setActiveUser(userId);
    });
  });
}

// --- Geolocation and Map Update Functions ---

// Function to update the location on the map and fetch address details
async function updateLocation(position) {
  if (!activeUserId) {
    locationText.textContent = "Please register or select an active user to track.";
    return;
  }

  const { latitude, longitude } = position.coords;
  const currentUser = users[activeUserId];

  // Update the active user's location data
  currentUser.location = {
    latitude: latitude,
    longitude: longitude,
    timestamp: new Date().toISOString(),
    address: 'Locating...' // Placeholder until geocoding completes
  };
  saveUsers(); // Save updated location immediately

  // Update location text initially with coordinates for the current device
  locationText.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  // Create/Update marker for the active user
  if (!userMarkers[activeUserId]) {
    userMarkers[activeUserId] = L.marker([latitude, longitude])
                                .addTo(map)
                                .bindPopup(`<b>${currentUser.name}</b><br>Locating...`);
    currentUser.marker = userMarkers[activeUserId]; // Store Leaflet marker object
  } else {
    userMarkers[activeUserId].setLatLng([latitude, longitude]);
  }
  // Center map on the active user's current location
  map.setView([latitude, longitude], 16);
  userMarkers[activeUserId].openPopup(); // Show popup for the active user

  // Reverse geocoding using OpenStreetMap Nominatim API
  const nominatimApiUrl = `${nominatimApiBaseUrl}&lat=${latitude}&lon=${longitude}`;

  try {
    const response = await fetch(nominatimApiUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    let displayAddress = "Unknown Location";
    if (data.address) {
      const road = data.address.road || '';
      const city = data.address.city || data.address.town || data.address.village || data.address.hamlet || '';
      const country = data.address.country || '';

      // Construct a more detailed address
      const parts = [];
      if (road) parts.push(road);
      if (city) parts.push(city);
      if (country) parts.push(country);
      displayAddress = parts.join(', ') || "Unknown Location";
    }
    locationText.textContent = displayAddress;
    userMarkers[activeUserId].setPopupContent(`<b>${currentUser.name}</b><br>${displayAddress}`);

    // Update the active user's stored location with the full address
    currentUser.location.address = displayAddress;
    saveUsers(); // Save with full address
    renderUserList(); // Re-render user list to show updated address
  } catch (error) {
    console.error("Error fetching location details:", error);
    locationText.textContent = `Error getting details (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
    userMarkers[activeUserId].setPopupContent(`<b>${currentUser.name}</b><br>Error getting address`);
  }
}

// Function to handle geolocation errors
function handleError(err) {
  alert("Error getting location: " + err.message);
  console.error("Geolocation error:", err);
  locationText.textContent = `Geolocation error: ${err.message}`;
}

// --- Widget Functionality ---
function setupCollapsiblePanels() {
  document.querySelectorAll('.panel-header').forEach(header => {
    header.addEventListener('click', () => {
      const panel = header.closest('.panel');
      const toggleBtn = header.querySelector('.toggle-btn');
      const isCollapsed = panel.classList.toggle('collapsed');
      toggleBtn.textContent = isCollapsed ? '+' : '−';
      toggleBtn.setAttribute('aria-expanded', !isCollapsed);
    });
  });
}

// --- Event Listeners and Initial Load ---

userForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = userNameInput.value.trim();
  const email = userEmailInput.value.trim();
  if (name && email) {
    registerUser(name, email);
    userNameInput.value = '';
    userEmailInput.value = '';
    // Collapse registration panel after successful registration
    const registrationPanel = document.getElementById('registrationPanel');
    if (!registrationPanel.classList.contains('collapsed')) {
        registrationPanel.classList.add('collapsed');
        registrationPanel.querySelector('.toggle-btn').textContent = '+';
        registrationPanel.querySelector('.toggle-btn').setAttribute('aria-expanded', 'false');
    }
  } else {
    alert('Please enter both name and email.');
  }
});

// Initial load when the page loads
document.addEventListener('DOMContentLoaded', () => {
  loadUsers(); // Load existing users from local storage
  setupCollapsiblePanels(); // Initialize collapsible behavior

  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(updateLocation, handleError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    });
  } else {
    alert("Geolocation is not supported by this browser.");
    locationText.textContent = "Geolocation not supported.";
  }
});
