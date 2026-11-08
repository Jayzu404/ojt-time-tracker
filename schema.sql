CREATE DATABASE IF NOT EXISTS hours_tracker
  DEFAULT CHARACTER SET utf8mb4;

USE hours_tracker;

CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE goals (
  id                           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id                      INT UNSIGNED NOT NULL,
  target_minutes               INT UNSIGNED NOT NULL DEFAULT 0,
  previous_accumulated_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  assumed_hours_per_day        TINYINT UNSIGNED NOT NULL DEFAULT 8,
  status                       ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at                  TIMESTAMP NULL,
  CONSTRAINT fk_goals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_pace   CHECK (assumed_hours_per_day BETWEEN 1 AND 24),
  CONSTRAINT chk_target CHECK (target_minutes <= 100000 * 60),
  INDEX idx_goals_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE entries (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  goal_id    INT UNSIGNED NOT NULL,
  entry_date DATE NOT NULL,
  time_in    TIME NOT NULL,
  time_out   TIME NOT NULL,
  minutes    SMALLINT UNSIGNED
             GENERATED ALWAYS AS ((TIME_TO_SEC(time_out) - TIME_TO_SEC(time_in)) DIV 60) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_entries_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
  CONSTRAINT chk_time_order CHECK (time_out > time_in),
  INDEX idx_entries_goal_date (goal_id, entry_date, time_in)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sessions (
  id         CHAR(64) PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;