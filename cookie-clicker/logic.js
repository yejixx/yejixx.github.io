var count = 0;
var plusclicks = 1;
var autoclicks = 0;


function loadGame() {
    const saved = localStorage.getItem('clickerGame');
    if (saved) {
        const data = JSON.parse(saved);
        count = data.count || 0;
        plusclicks = data.plusclicks || 1;
        autoclicks = data.autoclicks || 0;
    }
    updateDisplay();
}

function saveGame() {
    const data = {
        count: count,
        plusclicks: plusclicks,
        autoclicks: autoclicks
    };
    localStorage.setItem('clickerGame', JSON.stringify(data));
}


function clickME() {
    count += plusclicks;
    updateDisplay();
    saveGame();
}

function buyUpgrade1() {
        if (count >= 10) {
            count -= 10;
            plusclicks += 1;
            updateDisplay();
            saveGame();
        } else {
            alert("Not enough clicks to buy Upgrade 1!");
        }
}

function buyUpgrade2()  {
        if (count >= 50) {
            count -= 50;
            autoclicks += 1;
            updateDisplay();
            saveGame();
        } else {
            alert("Not enough clicks to buy Upgrade 2!");
        }
}

function updateDisplay() {
    document.getElementById("clicks").innerHTML = count;
    document.getElementById("cps").innerHTML = plusclicks;
    document.getElementById("autoclicks").innerHTML = autoclicks;
}

function autoClicker() {
    if (autoclicks > 0) {  
        count += autoclicks;
        updateDisplay();
        saveGame();
    }
}
window.onload = function() {
    loadGame();
    setInterval(autoClicker, 1000);  
}