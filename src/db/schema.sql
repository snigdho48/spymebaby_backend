-- BrainCount database schema (MySQL 8+)
-- Run with: npm run init-db  (or import this file manually)

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  name VARCHAR(150),
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  image VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS trackers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tracker_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tracker_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS contents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid CHAR(36) NOT NULL UNIQUE,
  tracker_uuid CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  imp_code VARCHAR(64) NOT NULL UNIQUE,
  click_code VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_content_tracker FOREIGN KEY (tracker_uuid) REFERENCES trackers(uuid) ON DELETE CASCADE,
  INDEX idx_content_tracker (tracker_uuid),
  INDEX idx_content_imp (imp_code),
  INDEX idx_content_click (click_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tracking_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tracker_uuid CHAR(36) NOT NULL,
  content_uuid CHAR(36) NOT NULL,
  type ENUM('imp', 'click') NOT NULL,
  browser VARCHAR(50) DEFAULT 'Other',
  os VARCHAR(50) DEFAULT 'Other',
  client_ip VARCHAR(64),
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  portal_url VARCHAR(255),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_tracker (tracker_uuid),
  INDEX idx_event_content (content_uuid),
  INDEX idx_event_type (type),
  INDEX idx_event_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS data_imports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  tracker_uuid CHAR(36) NOT NULL,
  event_count BIGINT NOT NULL DEFAULT 0,
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Exact daily totals from local Excel import (not used on production pixel-only trackers).
CREATE TABLE IF NOT EXISTS campaign_daily_stats (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tracker_uuid CHAR(36) NOT NULL,
  content_uuid CHAR(36) NOT NULL,
  stat_date DATE NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  unique_reach BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_campaign_day (tracker_uuid, content_uuid, stat_date),
  INDEX idx_campaign_tracker (tracker_uuid),
  INDEX idx_campaign_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
