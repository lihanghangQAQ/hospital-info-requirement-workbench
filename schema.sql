-- ============================================================
-- 医院信息需求管理工作台 · MySQL 建表脚本
-- 用途：后续 self-host / 源码上传 GitHub / 数据迁至 Supabase 的数据库底座
-- 说明：本工作台在线版默认使用浏览器本地存储；此脚本用于将数据迁移到 MySQL，
--      供服务端演进（Flask/Node + MySQL）时对接，字段与页面数据层一一对应。
-- ============================================================
CREATE DATABASE IF NOT EXISTS hospital_req_workbench DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hospital_req_workbench;

-- ------------------------------------------------------------
-- 1. 信息需求表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS req_requirement;
CREATE TABLE req_requirement (
  id          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  bh          VARCHAR(60)  NOT NULL COMMENT '编号',
  year        VARCHAR(8)   DEFAULT '' COMMENT '年度',
  pri         VARCHAR(10)  DEFAULT '中' COMMENT '优先级:高/中/低',
  cat         VARCHAR(30)  DEFAULT '' COMMENT '需求类别',
  dept        VARCHAR(100) DEFAULT '' COMMENT '提交部门',
  sys_name    VARCHAR(100) DEFAULT '' COMMENT '业务系统',
  desc_text   VARCHAR(1000) DEFAULT '' COMMENT '问题描述',
  plan_text   VARCHAR(1000) DEFAULT '' COMMENT '处理方案',
  status      VARCHAR(15)  DEFAULT '待办' COMMENT '状态:待办/进行中/已完成/已关闭',
  stage       VARCHAR(20)  DEFAULT '' COMMENT '所处阶段',
  sub_date    DATE         NULL COMMENT '提交日期',
  plan_date   DATE         NULL COMMENT '计划日期',
  done_date   DATE         NULL COMMENT '完成日期',
  days        INT          DEFAULT 0 COMMENT '历时天数',
  carry       TINYINT      DEFAULT 0 COMMENT '跨年长尾 0/1',
  note        VARCHAR(500) DEFAULT '' COMMENT '备注',
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_req_bh (bh),
  KEY idx_req_dept (dept), KEY idx_req_status (status), KEY idx_req_year (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='信息需求表';

-- ------------------------------------------------------------
-- 2. 数据统计需求表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS stat_requirement;
CREATE TABLE stat_requirement (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  bh          VARCHAR(60)  NOT NULL COMMENT '编号',
  year        VARCHAR(8)   DEFAULT '',
  pri         VARCHAR(10)  DEFAULT '中',
  cat         VARCHAR(30)  DEFAULT '数据统计',
  dept        VARCHAR(100) DEFAULT '' COMMENT '提交部门',
  submitter   VARCHAR(60)  DEFAULT '' COMMENT '提交人',
  risk        VARCHAR(10)  DEFAULT '低' COMMENT '安全风险:低/中/高/敏感',
  status      VARCHAR(15)  DEFAULT '待办',
  stage       VARCHAR(20)  DEFAULT '',
  sub_date    DATE         NULL,
  plan_date   DATE         NULL,
  done_date   DATE         NULL,
  days        INT          DEFAULT 0,
  carry       TINYINT      DEFAULT 0,
  note        VARCHAR(500) DEFAULT '',
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_stat_bh (bh),
  KEY idx_stat_dept (dept), KEY idx_stat_risk (risk)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据统计需求表';

-- ------------------------------------------------------------
-- 3. 年度总结归档表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS annual_archive;
CREATE TABLE annual_archive (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  series     VARCHAR(30)  DEFAULT '年度总结' COMMENT '系列:年度总结/系列报告/专题分析/科室总结',
  year       VARCHAR(8)   DEFAULT '',
  title      VARCHAR(200) DEFAULT '' COMMENT '标题',
  author     VARCHAR(60)  DEFAULT '' COMMENT '作者',
  full_text  TEXT         COMMENT '全文',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_annual_year (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='年度总结归档表';

-- ------------------------------------------------------------
-- 4. 周报归档表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS weekly_archive;
CREATE TABLE weekly_archive (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  no         VARCHAR(40)  DEFAULT '' COMMENT '期号',
  week       VARCHAR(60)  DEFAULT '' COMMENT '周期区间',
  cols       JSON         NULL COMMENT '栏目数据(JSON)',
  note       VARCHAR(500) DEFAULT '' COMMENT '备注',
  count_val  INT          DEFAULT 0 COMMENT '计数',
  summary    TEXT         COMMENT '总结',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_weekly_no (no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='周报归档表';

-- ------------------------------------------------------------
-- 5. 用户表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS sys_user;
CREATE TABLE sys_user (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  account    VARCHAR(60)  NOT NULL COMMENT '账号',
  display    VARCHAR(100) DEFAULT '' COMMENT '显示名',
  role       VARCHAR(15)  DEFAULT '普通' COMMENT '角色:管理员/普通',
  pass_hash  VARCHAR(128) DEFAULT '' COMMENT '密码哈希',
  status     VARCHAR(10)  DEFAULT '启用' COMMENT '状态:启用/停用',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_account (account)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- 默认管理员 admin / admin123（生产请务必修改）
INSERT INTO sys_user (account, display, role, pass_hash, status)
SELECT 'admin', '信息科管理员', '管理员',
       '$2b$12$placeholder_endpoint_please_set', '启用'
WHERE NOT EXISTS (SELECT 1 FROM sys_user WHERE account='admin');

-- ------------------------------------------------------------
-- 6. 操作日志表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS sys_operation_log;
CREATE TABLE sys_operation_log (
  id         BIGINT NOT NULL AUTO_INCREMENT,
  who        VARCHAR(100) DEFAULT '' COMMENT '操作人',
  action     VARCHAR(60)  DEFAULT '' COMMENT '操作类型',
  target     VARCHAR(60)  DEFAULT '' COMMENT '对象',
  detail     VARCHAR(1000) DEFAULT '' COMMENT '详情',
  result     VARCHAR(10)  DEFAULT '成功' COMMENT '结果',
  ip         VARCHAR(60)  DEFAULT '' COMMENT 'IP',
  op_time    DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (id),
  KEY idx_log_time (op_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志表';

-- ------------------------------------------------------------
-- 7. 受控词表（数据治理）
-- ------------------------------------------------------------
DROP TABLE IF EXISTS gov_vocabulary;
CREATE TABLE gov_vocabulary (
  id    BIGINT NOT NULL AUTO_INCREMENT,
  cat   VARCHAR(30)  DEFAULT '' COMMENT '类别',
  value VARCHAR(120) DEFAULT '' COMMENT '取值',
  PRIMARY KEY (id),
  UNIQUE KEY uk_vocab (cat, value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='受控词表';
