const app = {
    apiKey: localStorage.getItem('saygo_gemini_api_key') || '',
    location: {
        lat: null,
        lon: null,
        display: null
    },
    itineraryHistory: [],
    currentItinerary: [], // Store current JSON data

    init() {
        this.bindEvents();
        this.checkApiKey();
        this.getLocation();
    },

    bindEvents() {
        document.getElementById('auth-btn').addEventListener('click', () => this.showModal());
        document.getElementById('close-modal-btn').addEventListener('click', () => this.hideModal());
        document.getElementById('save-key-btn').addEventListener('click', () => this.saveApiKey());
        document.getElementById('clear-key-btn').addEventListener('click', () => {
            if (confirm('確定要清除儲存的 API Key 嗎？')) this.resetApiKey();
        });
        document.getElementById('refresh-loc-btn').addEventListener('click', () => this.getLocation());
        document.getElementById('travel-form').addEventListener('submit', (e) => this.handleGenerate(e));
        document.getElementById('regenerate-btn').addEventListener('click', (e) => this.handleGenerate(e));
        document.getElementById('download-btn').addEventListener('click', () => this.downloadImage());
    },

    // ... (Auth and Location methods remain mostly same, mostly abbreviated for this plan but will be fully written in file) ...
    checkApiKey() { if (!this.apiKey) this.showModal(); },
    showModal() { document.getElementById('api-modal').classList.remove('hidden'); document.getElementById('api-key-input').value = this.apiKey; },
    hideModal() { document.getElementById('api-modal').classList.add('hidden'); },
    saveApiKey() {
        const input = document.getElementById('api-key-input').value.trim();
        if (input) { this.apiKey = input; localStorage.setItem('saygo_gemini_api_key', input); this.hideModal(); alert('API Key 已儲存！'); }
    },
    resetApiKey() { this.apiKey = ''; localStorage.removeItem('saygo_gemini_api_key'); this.showModal(); },

    getLocation() {
        const locDisplay = document.getElementById('current-location');
        locDisplay.textContent = '正在定位中...';
        locDisplay.classList.add('loading');
        if (!navigator.geolocation) { locDisplay.textContent = '您的裝置不支援定位功能'; locDisplay.classList.remove('loading'); return; }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.location.lat = position.coords.latitude;
                this.location.lon = position.coords.longitude;
                this.reverseGeocode(this.location.lat, this.location.lon);
            },
            (error) => {
                console.error('Location error:', error);
                locDisplay.textContent = '無法取得位置';
                locDisplay.classList.remove('loading');
            }
        );
    },

    async reverseGeocode(lat, lon) {
        const locDisplay = document.getElementById('current-location');
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=zh-TW`);
            const data = await response.json();
            const address = data.address;
            const city = address.city || address.county || '';
            const district = address.suburb || address.town || address.district || '';
            this.location.display = `${city}${district}`;
            locDisplay.textContent = this.location.display;
        } catch (error) {
            locDisplay.textContent = `座標: ${lat.toFixed(3)}, ${lon.toFixed(3)}`;
            this.location.display = `座標(${lat.toFixed(3)}, ${lon.toFixed(3)})`;
        } finally {
            locDisplay.classList.remove('loading');
        }
    },

    async handleGenerate(e) {
        e.preventDefault();
        if (!this.apiKey) return this.showModal();
        if (!this.location.display && !this.location.lat) return alert('無法取得位置');

        const transport = document.getElementById('transport').value;
        const startTime = document.getElementById('start-time').value;
        const endTime = document.getElementById('end-time').value;
        const preferences = document.getElementById('preferences').value;
        const companions = document.getElementById('companions').value || '無';
        const locationName = this.location.display || `座標 ${this.location.lat}, ${this.location.lon}`;

        const resultSection = document.getElementById('result-area');
        const resultContent = document.getElementById('result-content');
        const loading = document.getElementById('loading-indicator');
        const submitBtn = document.querySelector('.cta-button');

        resultSection.classList.remove('hidden');
        loading.classList.remove('hidden');
        resultContent.innerHTML = '';
        submitBtn.disabled = true;
        submitBtn.textContent = '規劃中...';

        const historyContext = this.itineraryHistory.slice(-3).map(h => `(避開: ${h})`).join('\n');

        const prompt = `
你是一個專業的在地旅遊嚮導。請為我規劃一個「一日遊行程」，並輸出為 JSON 格式。

【基本資訊】
目前位置：${locationName}
行程範圍：限制在「${this.location.display || '該行政區'}」範圍內（除非真的無處可去，可微幅擴展）。
移動方式：${transport}
時間安排：${startTime} 到 ${endTime}
旅遊喜好：${preferences}
同行者：${companions}

【規則】
1. **真實性**：只推薦 Google Maps 找得到的真實地點，並附上地址。
2. **交通**：各點之間要預留合理的 ${transport} 移動時間。
3. **節奏**：依照使用者需求與景點性質安排，不要太趕也不要太鬆（除非使用者要求）。
4. **輸出格式**：只輸出純 JSON，不要 Markdown，不要解釋。格式如下：
{
  "title": "行程標題",
  "items": [
    {
      "time": "時間區段",
      "name": "景點名稱",
      "address": "地址",
      "desc": "簡介與特色",
      "traffic": "前往下一站交通時間 (若是最後一站則留空)"
    }
  ]
}
5. **避開重複**：${historyContext}
`;

        try {
            const result = await this.callGeminiApi(prompt);
            const jsonStr = result.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(jsonStr);

            this.currentItinerary = data;
            this.itineraryHistory.push(data.title); // Simplification for history

            this.renderItinerary(data);
            document.getElementById('result-actions').classList.remove('hidden');

        } catch (error) {
            console.error(error);
            resultContent.innerHTML = `<p class="error">發生錯誤：${error.message}</p>`;
        } finally {
            loading.classList.add('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = '旅 遊 吧 ! 🎒';
            resultSection.scrollIntoView({ behavior: 'smooth' });
        }
    },

    renderItinerary(data) {
        const container = document.getElementById('result-content');
        container.innerHTML = `<h1>${data.title}</h1>`;

        const list = document.createElement('div');
        list.className = 'itinerary-list';

        data.items.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'itinerary-card';
            card.innerHTML = `
                <div class="card-time">${item.time}</div>
                <div class="card-content">
                    <div class="card-header">
                        <h3>${item.name}</h3>
                        <button class="icon-btn small refresh-spot-btn" data-index="${index}" title="更換這個景點">🔄</button>
                    </div>
                    <p class="card-address">📍 <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.name + ' ' + item.address)}" target="_blank">${item.address}</a></p>
                    <p class="card-desc">${item.desc}</p>
                    ${item.traffic ? `<div class="card-traffic">🚗 ${item.traffic}</div>` : ''}
                </div>
            `;
            list.appendChild(card);
        });

        container.appendChild(list);

        // Bind refresh buttons
        container.querySelectorAll('.refresh-spot-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.refreshSpot(parseInt(e.currentTarget.dataset.index)));
        });
    },

    async refreshSpot(index) {
        if (!confirm('要更換這個景點嗎？')) return;

        const oldItem = this.currentItinerary.items[index];
        const prevItem = index > 0 ? this.currentItinerary.items[index - 1] : { name: "出發點" };
        const nextItem = index < this.currentItinerary.items.length - 1 ? this.currentItinerary.items[index + 1] : null;

        const btn = document.querySelector(`.refresh-spot-btn[data-index="${index}"]`);
        btn.classList.add('spinning'); // Add CSS animation

        const prompt = `
請幫我將行程中的這個景點：「${oldItem.name}」更換成另一個不同的地點。
【上下文】
前一站：${prevItem.name}
後一站：${nextItem ? nextItem.name : "結束"}
區域：${this.location.display}
時間：${oldItem.time}
喜好：${document.getElementById('preferences').value}

【規則】
1. 不要推薦 ${oldItem.name}。
2. 保持時間與動線順暢。
3. 輸出單一 JSON 物件：
{
  "time": "${oldItem.time}",
  "name": "新景點名稱",
  "address": "地址",
  "desc": "簡介",
  "traffic": "交通資訊"
}
`;
        try {
            const result = await this.callGeminiApi(prompt);
            const jsonStr = result.replace(/```json/g, '').replace(/```/g, '').trim();
            const newItem = JSON.parse(jsonStr);

            this.currentItinerary.items[index] = newItem;
            this.renderItinerary(this.currentItinerary);
        } catch (e) {
            alert('更換失敗，請重試');
        }
    },

    // ... callGeminiApi (with auto detect) ...
    async callGeminiApi(prompt) {
        let validModel = await this.findValidModel();
        if (!validModel) validModel = 'gemini-pro';
        return await this.tryModel(validModel, prompt);
    },

    async findValidModel() {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
            const data = await response.json();
            const m = data.models?.find(m => m.supportedGenerationMethods?.includes('generateContent') && !m.name.includes('vision')); // prefer text models
            return m ? m.name.replace('models/', '') : null;
        } catch (e) { return null; }
    },

    async tryModel(model, prompt) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    },

    downloadImage() {
        const target = document.getElementById('capture-target');
        document.querySelector('.watermark').style.display = 'block';
        html2canvas(target, { backgroundColor: '#ffffff', scale: 2 }).then(canvas => {
            document.querySelector('.watermark').style.display = 'none';
            const link = document.createElement('a');
            link.download = `行程_${Date.now()}.jpg`;
            link.href = canvas.toDataURL();
            link.click();
        });
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
