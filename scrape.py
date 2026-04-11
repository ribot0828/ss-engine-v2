from http.server import BaseHTTPRequestHandler
import urllib.parse
import json
import requests
from bs4 import BeautifulSoup
import re

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        query_components = urllib.parse.parse_qs(parsed_path.query)
        url = query_components.get('url', [None])[0]
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        if not url:
            self.wfile.write(json.dumps({"error": "URL is required"}).encode('utf-8'))
            return

        try:
            data = self.scrape_netkeiba(url)
            self.wfile.write(json.dumps(data).encode('utf-8'))
        except Exception as e:
            self.wfile.write(json.dumps({"error": "Scraping failed: " + str(e)}).encode('utf-8'))
        return

    def fetch_odds_api(self, race_id):
        """netkeiba Odds APIから単勝オッズと人気を取得"""
        api_url = f"https://race.netkeiba.com/api/api_get_jra_odds.html?race_id={race_id}&type=1"
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            res = requests.get(api_url, headers=headers, timeout=5)
            data = res.json()
            if data.get("status") in ["result", "middle_now"] and data.get("data") and data["data"].get("odds"):
                odds_map = {}
                for bracket, horses in data["data"]["odds"].items():
                    for umaban_str, vals in horses.items():
                        try:
                            umaban = int(umaban_str)
                            odds = float(vals[0]) if vals[0] else 0.0
                            popular = vals[2] if len(vals) > 2 else ""
                            odds_map[umaban] = {"odds": odds, "popular": str(popular)}
                        except (ValueError, IndexError):
                            pass
                return odds_map
        except Exception:
            pass
        return {}

    def scrape_netkeiba(self, url):
        match = re.search(r'race_id=(\d+)', url)
        race_id = None
        if match:
            race_id = match.group(1)
            page_type = 'result' if 'result' in url else 'shutuba'
            url = f"https://race.netkeiba.com/race/{page_type}.html?race_id={race_id}"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        res = requests.get(url, headers=headers)
        res.raise_for_status()
        
        res.encoding = 'euc-jp' 
        soup = BeautifulSoup(res.text, 'html.parser')

        race_name_elem = soup.select_one(".RaceName")
        race_name = race_name_elem.text.strip() if race_name_elem else "不明なレース"

        course_info_elem = soup.select_one(".RaceData01")
        if course_info_elem:
            course_text = course_info_elem.text.strip().replace('\n', ' ')
            course_info = re.sub(r'^[0-9]+:[0-9]+\s*発走\s*/\s*', '', course_text)
        else:
            course_info = ""
        
        grade_elem = soup.select_one(".RaceData02")
        raw_grade = grade_elem.text.replace('\n', ' ').strip() if grade_elem else ""
        
        grade_info = "不明"
        if raw_grade:
            match_grade = re.search(r'(オープン|3勝クラス|2勝クラス|1勝クラス|新馬|未勝利|OP|G1|G2|G3|GⅠ|GⅡ|GⅢ|Jpn1|Jpn2|Jpn3)', raw_grade)
            if match_grade:
                grade_info = match_grade.group(1)
            
            grade_icon = soup.select_one('.Icon_GradeType') or soup.find(class_=lambda x: x and 'Icon_GradeType' in x)
            if grade_icon:
                classes = grade_icon.get('class', [])
                if 'Icon_GradeType1' in classes: grade_info = 'G1'
                elif 'Icon_GradeType2' in classes: grade_info = 'G2'
                elif 'Icon_GradeType3' in classes: grade_info = 'G3'
                elif grade_icon.text.strip(): grade_info = grade_icon.text.strip()
            
            match_head = re.search(r'([0-9]+頭)', raw_grade)
            if match_head:
                grade_info += f" {match_head.group(1)}"

        date_elem = soup.select_one(".RaceList_DateBox .Active") or soup.select_one("#RaceList_DateList .Active")
        date_info = date_elem.text.strip() if date_elem else ""

        horses = []
        seen_umaban = set()
        rows = soup.select(".HorseList")
        is_result_page = 'result.html' in url

        for i, row in enumerate(rows):
            try:
                placing = ""
                popular = ""
                if is_result_page:
                    rank_elem = row.select_one("td.Result_Num") or row.select_one("td[class*='Result_Num']") or row.select_one("td.Rank")
                    placing = rank_elem.text.strip() if rank_elem else ""

                    umaban_elem = row.select_one("td.Num.Txt_C") or row.select_one("td[class*='Num']")
                    if not umaban_elem: continue
                    try:
                        umaban = int(umaban_elem.text.strip())
                    except ValueError:
                        umaban = i + 1

                    horse_name_elem = row.select_one(".Horse_Info")
                    horse_name = horse_name_elem.text.strip() if horse_name_elem else "不明"

                    odds_tds = row.select("td[class*='Odds']")
                    if len(odds_tds) >= 2:
                        popular = odds_tds[0].text.strip()
                        odds_text = odds_tds[1].text.strip()
                    else:
                        odds_elem = row.select_one("td.Odds.Txt_R") or row.select_one("td.Odds")
                        odds_text = odds_elem.text.strip() if odds_elem else "0.0"
                else:
                    # PC版: Umaban列がある（class^='Umaban'）
                    umaban_elem = row.select_one("td[class^='Umaban']") or row.select_one("td.Umaban")
                    if umaban_elem:
                        try:
                            umaban = int(umaban_elem.text.strip())
                        except ValueError:
                            umaban = i + 1
                        horse_name_elem = row.select_one(".HorseName a") or row.select_one(".HorseName") or row.select_one(".HorseInfo")
                        horse_name = horse_name_elem.text.strip() if horse_name_elem else "不明"
                    else:
                        # SP版: Umaban列がなく、Waku列(index 0) + Horse_Info列(index 2)構造
                        umaban = i + 1
                        horse_info_elem = row.select_one("td.Horse_Info") or row.select_one("td.HorseName")
                        if horse_info_elem:
                            # 馬名のみ取り出す（余分なテキストを除去）
                            for tag in horse_info_elem.find_all(['span', 'small', 'a']):
                                tag.decompose()
                            horse_name = horse_info_elem.text.strip().split('\n')[0].strip()
                        else:
                            horse_name = "不明"

                    opts = row.select("td.Popular") or row.select("td.Txt_C.Popular")
                    popular = opts[0].text.strip() if opts else ""

                    odds_elem = row.select_one("td.Txt_R span") or row.select_one("td.Popular span") or row.select_one("td.Odds span") or row.select_one("td.Txt_R.Popular") or row.select_one("td.Popular") or row.select_one("td.Txt_R")
                    odds_text = odds_elem.text.strip() if odds_elem else "0.0"
                
                try:
                    odds = float(odds_text)
                except ValueError:
                    odds = 0.0

                # Clean up invalid placeholder values
                if popular in ['**', '---.-', '-', '']:
                    popular = ''

                if umaban in seen_umaban:
                    continue
                seen_umaban.add(umaban)

                horses.append({
                    "umaban": umaban,
                    "name": horse_name,
                    "odds": odds,
                    "popular": popular,
                    "rank": "B",
                    "placing": placing
                })
            except Exception as e:
                pass

        # 出馬表ページでオッズがJS遅延ロードの場合、APIから補完
        odds_unavailable = False
        if not is_result_page and race_id:
            has_valid_odds = any(h["odds"] > 0 for h in horses)
            if not has_valid_odds:
                odds_map = self.fetch_odds_api(race_id)
                if odds_map:
                    for h in horses:
                        api_data = odds_map.get(h["umaban"])
                        if api_data:
                            h["odds"] = api_data["odds"]
                            h["popular"] = api_data["popular"]
                else:
                    # APIからも取得できない = オッズ未発売
                    odds_unavailable = True

        payouts = {}
        for tbl in soup.select('.Payout_Detail_Table'):
            for tr in tbl.select('tr'):
                th = tr.select_one('th')
                if not th: continue
                type_name = th.text.strip()
                if type_name in ['単勝', 'ワイド', '3連複']:
                    tds = tr.select('td')
                    if len(tds) >= 2:
                        payouts[type_name] = tds[1].text.strip().replace('\n', ' ')

        return {
            "race_name": race_name,
            "course_info": course_info,
            "grade_info": grade_info,
            "date_info": date_info,
            "horses": horses,
            "payouts": payouts,
            "odds_unavailable": odds_unavailable
        }
