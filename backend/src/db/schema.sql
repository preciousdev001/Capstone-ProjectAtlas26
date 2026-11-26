CREATE TABLE users (
    user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_name       VARCHAR(50) NOT NULL UNIQUE,
    user_email      VARCHAR(255) NOT NULL UNIQUE,
    user_is_business BOOLEAN NOT NULL DEFAULT FALSE,
    user_password   TEXT NOT NULL, -- hashed pass, never plain, security can get in trouble if not
    user_prof_img   TEXT
);

CREATE TABLE locations (
    loc_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loc_name             TEXT NOT NULL,
    loc_desc             TEXT,
    loc_address          TEXT NOT NULL,
    loc_phone            TEXT,
    loc_is_power         BOOLEAN NOT NULL DEFAULT FALSE,
    loc_categories       TEXT,
    loc_coordinates_lat  DOUBLE PRECISION NOT NULL,
    loc_coordinates_long DOUBLE PRECISION NOT NULL,
    loc_permissions      TEXT,
    loc_imgs             TEXT,
    loc_owner_type       TEXT
);

CREATE TABLE location_hours (
    hours_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loc_id          UUID NOT NULL REFERENCES locations(loc_id) ON DELETE CASCADE,
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time       TIME,
    close_time      TIME,
    is_closed       BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (loc_id, day_of_week)
);

CREATE TABLE lists (
    list_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    list_name       TEXT NOT NULL,
    list_desc       TEXT,
    list_categories TEXT    
);

CREATE TABLE tags (
    tag_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_name    TEXT NOT NULL UNIQUE,
);

CREATE TABLE list_locations (
    list_loc_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id       UUID NOT NULL REFERENCES lists(list_id) ON DELETE CASCADE,
    loc_id        UUID NOT NULL REFERENCES locations(loc_id) ON DELETE CASCADE,
    list_loc_desc TEXT,
    loc_id_order  INTEGER NOT NULL CHECK (loc_id_order > 0), 
    UNIQUE (list_id, loc_id),
    UNIQUE (list_id, loc_id_order)
);

CREATE TABLE location_tags (
    loc_id UUID NOT NULL REFERENCES locations(loc_id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
    PRIMARY KEY (loc_id, tag_id)
);

CREATE TABLE list_tags (
    list_id UUID NOT NULL REFERENCES lists(list_id) ON DELETE CASCADE,
    tag_id  UUID NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
    PRIMARY KEY (list_id, tag_id)
);

CREATE TABLE reviews (
    rev_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loc_id    UUID NOT NULL REFERENCES locations(loc_id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, 
    rev_title TEXT NOT NULL,
    rev_desc  TEXT NOT NULL,
    rev_rating NUMERIC(2,1) NOT NULL CHECK (rev_rating BETWEEN 0 AND 5),
    rev_imgs  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now() --option to leave new rev after certain time has passed
);