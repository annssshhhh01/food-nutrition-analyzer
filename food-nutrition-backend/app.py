import json
import requests
import threading  
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import torch
import torchvision.transforms as transforms
import torchvision.models as models
import os 
from dotenv import load_dotenv 

load_dotenv() 

# --- Configuration & Initialization ---
app = Flask(__name__)
CORS(app)


APP_ID = os.getenv("EDAMAM_APP_ID")
APP_KEY = os.getenv("EDAMAM_APP_KEY")


# Define the path to your local database
DB_FILE_PATH = 'data/nutrition_db.json'
# Create a lock to prevent errors when writing to the file simultaneously
db_lock = threading.Lock()

# Load the local nutrition database (cache) at startup
try:
    with open(DB_FILE_PATH, 'r') as f:
        nutrition_db = json.load(f)
    print(f"Loaded {len(nutrition_db)} entries from local nutrition DB (cache).")
except (FileNotFoundError, json.JSONDecodeError):
    nutrition_db = {}
    print("⚠️ Local nutrition DB not found or empty. Starting with a fresh cache.")

# --- Load AI Model and Supporting Files ---
with open('data/class_names.json') as f:
    class_names = json.load(f)

model = models.efficientnet_b0(weights=None)
num_ftrs = model.classifier[1].in_features
model.classifier[1] = torch.nn.Linear(num_ftrs, len(class_names))
model.load_state_dict(torch.load('models/food_model.pth', map_location=torch.device('cpu')))
model.eval()

preprocess = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

# --- Helper Function: Fetch from Edamam API ---

def get_nutrition_data_from_api(food_name):
    """Fetches detailed nutrition data for a food name from the Edamam API."""
    if APP_ID == "EDAMAM_APP_ID" or APP_KEY == "EDAMAM_APP_KEY":
        print("🛑 API credentials are not set in app.py.")
        return None

    url = f"https://api.edamam.com/api/nutrition-details?app_id={APP_ID}&app_key={APP_KEY}"
    payload = {"ingr": [f"100g {food_name.lower()}"]}

    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()
        data = response.json()

        try:
            parsed_data = data['ingredients'][0]['parsed'][0]
            nutrients = parsed_data.get('nutrients', {})
        except (IndexError, KeyError):
            print(f"⚠️ Could not parse nutrition data from API response for '{food_name}'")
            return None

        if not nutrients:
            print(f"⚠️ No detailed nutrition data found for '{food_name}'")
            return None

        def get_nutrient(key):
            return round(nutrients.get(key, {}).get('quantity', 0), 1)

        calories = int(get_nutrient('ENERC_KCAL'))

        if calories == 0:
            print(f"⚠️ API returned 0 calories for '{food_name}', treating as not found.")
            return None

        formatted_data = {
            "nutritionPer100g": {
                "calories": calories, "protein": get_nutrient('PROCNT'),
                "fat": get_nutrient('FAT'), "carbs": get_nutrient('CHOCDF'),
                "fiber": get_nutrient('FIBTG'), "sugar": get_nutrient('SUGAR'),
                "sodium": get_nutrient('NA'), "cholesterol": get_nutrient('CHOLE'),
                "calcium": get_nutrient('CA'), "iron": get_nutrient('FE'),
                "magnesium": get_nutrient('MG'), "potassium": get_nutrient('K'),
                "zinc": get_nutrient('ZN'), "phosphorus": get_nutrient('P'),
                "vitaminA": get_nutrient('VITA_RAE'), "vitaminC": get_nutrient('VITC'),
                "thiaminB1": get_nutrient('THIA'), "riboflavinB2": get_nutrient('RIBF'),
                "niacinB3": get_nutrient('NIA'), "vitaminB6": get_nutrient('VITB6A'),
                "vitaminB12": get_nutrient('VITB12'), "vitaminD": get_nutrient('VITD'),
                "vitaminE": get_nutrient('TOCPHA'), "vitaminK": get_nutrient('VITK1'),
            },
            "allergens": []
        }
        return formatted_data
    except requests.exceptions.RequestException as e:
        print(f"API request failed for '{food_name}': {e}")
        return None


# --- Image Prediction Function  ---
def predict_image(image_file):
    img = Image.open(image_file.stream).convert('RGB')
    img_t = preprocess(img)
    batch_t = torch.unsqueeze(img_t, 0)
    with torch.no_grad():
        out = model(batch_t)
    probabilities = torch.nn.functional.softmax(out[0], dim=0)
    top3_prob, top3_catid = torch.topk(probabilities, 3)
    predictions = []
    for i in range(top3_prob.size(0)):
        class_name = class_names[top3_catid[i]].replace("_", " ").title()
        predictions.append({
            "label": class_name,
            "confidence": top3_prob[i].item()
        })
    return predictions


# --- Main API Endpoint ---
@app.route('/api/analyze', methods=['POST'])
def analyze():
    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files['image']

    try:
        predictions = predict_image(file)
        top_prediction_label = predictions[0]['label']
        nutrition_data = None

        # 1. Check local DB (cache) first
        if top_prediction_label in nutrition_db:
            print(f"CACHE HIT: Found '{top_prediction_label}' in local DB.")
            nutrition_data = nutrition_db[top_prediction_label]
        
        # 2. If not in cache, call the API
        else:
            print(f"CACHE MISS: '{top_prediction_label}' not found. Calling Edamam API...")
            nutrition_data = get_nutrition_data_from_api(top_prediction_label)
            
            # 3. If API call was successful, save the new data to our local DB
            if nutrition_data:
                print(f"SAVING: Saving '{top_prediction_label}' to local DB cache.")
                # Use the lock to safely write to the file
                with db_lock:
                    nutrition_db[top_prediction_label] = nutrition_data
                    try:
                        with open(DB_FILE_PATH, 'w') as f:
                            json.dump(nutrition_db, f, indent=4)
                    except IOError as e:
                        print(f"ERROR: Could not write to local DB file: {e}")
            else:
                print(f"API FAILED: No nutrition data found for '{top_prediction_label}'.")
    
        response = {
            "predictions": predictions,
            "nutritionPer100g": nutrition_data.get("nutritionPer100g") if nutrition_data else None,
            "allergens": nutrition_data.get("allergens") if nutrition_data else []
        }

        return jsonify(response)

    except Exception as e:
        print(f"An error occurred: {e}")
        return jsonify({"error": "Failed to analyze image"}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)